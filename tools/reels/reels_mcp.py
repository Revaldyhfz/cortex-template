"""reels — a local MCP server that lets Claude *watch* short-form video.

One call turns an Instagram reel (or a TikTok / YouTube Short / X video — anything
yt-dlp reads) into: metadata + caption, a timestamped Whisper transcript, and a
contact sheet of frames so on-screen text and charts are visible too.

No login is needed for public reels. For login-walled ones set
REELS_COOKIES_FROM_BROWSER=chrome (or edge/firefox) in the server's env.

Everything is cached under ~/.cache/cortex-reels/<id>/ (override with REELS_CACHE), so a
second call is instant. Whisper runs on an NVIDIA GPU when there is one (large-v3), otherwise
on the CPU (small; set REELS_WHISPER_MODEL=base for speed or medium for accuracy). macOS
always uses the CPU.
"""

from __future__ import annotations

import glob
import json
import os
import re
import subprocess
import sys
import wave
from pathlib import Path

# CUDA DLLs ship inside the venv (nvidia-cublas-cu12 / nvidia-cudnn-cu12); Windows
# needs them on the DLL search path before ctranslate2 loads.
if sys.platform == "win32":
    for _p in glob.glob(os.path.join(sys.prefix, "Lib", "site-packages", "nvidia", "*", "bin")):
        os.add_dll_directory(_p)
        os.environ["PATH"] = _p + os.pathsep + os.environ["PATH"]

import imageio_ffmpeg  # noqa: E402
import numpy as np  # noqa: E402
import yt_dlp  # noqa: E402
from mcp.server.mcpserver import Image, MCPServer  # noqa: E402

CACHE = Path(os.environ.get("REELS_CACHE") or Path.home() / ".cache" / "cortex-reels")
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
WHISPER_MODEL = os.environ.get("REELS_WHISPER_MODEL")  # None = pick by device

mcp = MCPServer(
    "reels",
    instructions=(
        "Use reel_read to consume an Instagram reel / short video URL: it returns the caption, "
        "a timestamped transcript and a frame contact sheet. Use reel_frames when on-screen text "
        "is too small in the sheet and you need full-resolution frames for a time window."
    ),
)

_whisper = None


def _log(msg: str) -> None:
    # stdout is the MCP transport — anything printed there corrupts the stream.
    print(msg, file=sys.stderr, flush=True)


def _clean_url(url: str) -> str:
    url = url.strip()
    # Instagram share links carry tracking params (?stkn=, ?igsh=) that yt-dlp does not need.
    if "instagram.com" in url:
        url = url.split("?")[0]
    return url


def _ffmpeg(*args: str) -> None:
    subprocess.run([FFMPEG, "-loglevel", "error", "-y", *args], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


MAX_SECONDS = float(os.environ.get("REELS_MAX_SECONDS", "900"))
_IG_ID = re.compile(r"instagram\.com/(?:[^/]+/)?(?:reels?|p|tv)/([A-Za-z0-9_-]+)")


def _download(url: str, comments: bool = False) -> tuple[Path, dict]:
    # Cache first: every request avoided is one less chance of Instagram throttling us.
    m = _IG_ID.search(url)
    if m and not comments:
        d = CACHE / m[1]
        if (d / "video.mp4").exists() and (d / "meta.json").exists():
            return d / "video.mp4", json.loads((d / "meta.json").read_text(encoding="utf-8"))
    opts = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "ffmpeg_location": FFMPEG,
        "outtmpl": str(CACHE / "%(id)s" / "video.%(ext)s"),
        "merge_output_format": "mp4",
        "logger": _QuietLogger(),
        "getcomments": comments,
        "retries": 3,
        "extractor_retries": 3,
        "retry_sleep_functions": {"http": lambda n: 2 ** n, "extractor": lambda n: 2 ** n},
    }
    browser = os.environ.get("REELS_COOKIES_FROM_BROWSER")
    if browser:
        opts["cookiesfrombrowser"] = (browser,)
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
        if (info.get("duration") or 0) > MAX_SECONDS:
            raise ValueError(f"{info.get('duration')}s is over REELS_MAX_SECONDS={MAX_SECONDS:.0f}")
        d = CACHE / info["id"]
        video = d / "video.mp4"
        if not video.exists():
            ydl.download([url])
    d.mkdir(parents=True, exist_ok=True)
    keep = {k: info.get(k) for k in (
        "id", "webpage_url", "uploader", "channel", "uploader_url", "upload_date", "duration",
        "like_count", "comment_count", "view_count", "description", "title")}
    keep["comments"] = [
        {"author": c.get("author"), "text": c.get("text"), "likes": c.get("like_count")}
        for c in (info.get("comments") or [])]
    if not keep.get("duration"):
        keep["duration"] = _probe_duration(video)
    (d / "meta.json").write_text(json.dumps(keep, indent=2, ensure_ascii=False), encoding="utf-8")
    return video, keep


class _QuietLogger:
    def debug(self, m): pass
    def info(self, m): pass
    def warning(self, m): _log(f"yt-dlp: {m}")
    def error(self, m): _log(f"yt-dlp: {m}")


def _probe_duration(video: Path) -> float | None:
    r = subprocess.run([FFMPEG, "-i", str(video)], capture_output=True, text=True)
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", r.stderr)
    return int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3]) if m else None


def _model():
    global _whisper
    if _whisper is None:
        from faster_whisper import WhisperModel
        if sys.platform != "darwin":  # no CUDA on macOS; do not even try
            try:
                _whisper = WhisperModel(WHISPER_MODEL or "large-v3", device="cuda", compute_type="float16")
                return _whisper
            except Exception as e:  # no GPU / CUDA libs — slower but works
                _log(f"cuda unavailable ({e}); using the CPU")
        _whisper = WhisperModel(WHISPER_MODEL or "small", device="cpu", compute_type="int8")
    return _whisper


def _transcribe(video: Path) -> str:
    out = video.parent / "transcript.txt"
    if out.exists():
        return out.read_text(encoding="utf-8")
    wav = video.parent / "audio.wav"
    _ffmpeg("-i", str(video), "-vn", "-ac", "1", "-ar", "16000", str(wav))
    # Feed raw samples: faster-whisper's own decoder breaks on newer PyAV releases.
    with wave.open(str(wav)) as w:
        audio = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
    segs, info = _model().transcribe(audio, vad_filter=True)
    lines = [f"[{s.start:6.1f}-{s.end:6.1f}] {s.text.strip()}" for s in segs]
    text = f"(language: {info.language}, p={info.language_probability:.2f})\n" + (
        "\n".join(lines) if lines else "(no speech detected — music only?)")
    out.write_text(text, encoding="utf-8")
    return text


def _sheet(video: Path, duration: float | None) -> Path:
    sheet = video.parent / "sheet.jpg"
    if not sheet.exists():
        # ~14 evenly spaced frames, whatever the length, in a 7x2 grid.
        step = max((duration or 30) / 14, 0.5)
        _ffmpeg("-i", str(video), "-vf", f"fps=1/{step:.3f},scale=320:-1,tile=7x2",
                "-frames:v", "1", "-q:v", "3", str(sheet))
    return sheet


@mcp.tool()
def reel_read(url: str, transcribe: bool = True, contact_sheet: bool = True,
              comments: bool = False) -> list:
    """Watch a reel / short video: returns metadata, caption, timestamped transcript and a
    contact sheet (14 frames spread over the clip, 7x2 grid) so on-screen text is visible.

    url: an Instagram reel/post URL (share params are stripped), or any yt-dlp-supported URL.
    comments: also fetch the public comments (slower; often where creators drop links).
    """
    video, meta = _download(_clean_url(url), comments)
    parts = [
        f"# {meta.get('channel') or meta.get('uploader')} — {meta['id']}",
        f"url: {meta.get('webpage_url')}  |  posted: {meta.get('upload_date')}  |  "
        f"duration: {meta.get('duration') and round(meta['duration'], 1)}s  |  "
        f"likes: {meta.get('like_count')}  comments: {meta.get('comment_count')}",
        "",
        "## Caption",
        meta.get("description") or meta.get("title") or "(none)",
    ]
    if transcribe:
        parts += ["", "## Transcript (seconds)", _transcribe(video)]
    if comments:
        cs = meta.get("comments") or []
        parts += ["", f"## Comments ({len(cs)} fetched)"]
        parts += [f"- {c['author']}: {c['text']}" + (f"  (+{c['likes']})" if c.get("likes") else "")
                  for c in cs] or ["(none returned — may need REELS_COOKIES_FROM_BROWSER)"]
    parts += ["", f"cache: {video.parent}"]
    out: list = ["\n".join(parts)]
    if contact_sheet:
        out.append(Image(path=_sheet(video, meta.get("duration"))))
    return out


@mcp.tool()
def reel_frames(url: str, start: float = 0.0, end: float | None = None, count: int = 4,
                width: int = 720) -> list:
    """Full-resolution frames from a time window, for reading small on-screen text or charts.

    start/end are seconds (end defaults to the clip end); count frames are spread evenly
    across the window (max 8).
    """
    video, meta = _download(_clean_url(url))
    end = end if end is not None else (meta.get("duration") or start + 1)
    count = max(1, min(count, 8))
    out: list = []
    for i in range(count):
        t = start + (end - start) * (i + 0.5) / count
        f = video.parent / f"frame_{t:07.2f}_{width}.jpg"
        if not f.exists():
            _ffmpeg("-ss", f"{t:.2f}", "-i", str(video), "-frames:v", "1",
                    "-vf", f"scale={width}:-1", "-q:v", "2", str(f))
        out += [f"t={t:.1f}s", Image(path=f)]
    return out


if __name__ == "__main__":
    CACHE.mkdir(parents=True, exist_ok=True)
    mcp.run("stdio")
