"""Offline self-test for the reels MCP server — no Instagram, no login.

    uv run python selftest.py

1. Starts the server over stdio as a real MCP client and checks both tools are listed.
2. Builds a 6-second test video (moving test pattern + a spoken-band tone) with ffmpeg,
   drops it into a throwaway cache, and runs the same transcript and contact-sheet code
   the tools use, on the CPU with Whisper "tiny" (a ~75 MB download on first run).

Exit code 0 means the pipeline works on this machine.
"""

import asyncio
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
tmp = Path(tempfile.mkdtemp(prefix="reels-selftest-"))
os.environ["REELS_CACHE"] = str(tmp)
os.environ.setdefault("REELS_WHISPER_MODEL", "tiny")
sys.path.insert(0, str(HERE))

failures = 0


def check(ok: bool, name: str, extra: str = "") -> None:
    global failures
    failures += 0 if ok else 1
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"\n      {extra}" if not ok and extra else ""), flush=True)


async def mcp_handshake() -> None:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    p = StdioServerParameters(command=sys.executable, args=[str(HERE / "reels_mcp.py")], env={**os.environ})
    async with stdio_client(p) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()
            names = sorted(t.name for t in (await s.list_tools()).tools)
            check(names == ["reel_frames", "reel_read"], "MCP server starts and lists reel_read + reel_frames", str(names))


asyncio.run(mcp_handshake())

import reels_mcp  # noqa: E402  (after REELS_CACHE is set)

clip = tmp / "selftest" / "video.mp4"
clip.parent.mkdir(parents=True)
subprocess.run(
    [reels_mcp.FFMPEG, "-loglevel", "error", "-y",
     "-f", "lavfi", "-i", "testsrc=size=640x360:rate=25:duration=6",
     "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
     "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(clip)],
    check=True,
)
check(clip.stat().st_size > 10_000, "ffmpeg builds a test clip")

sheet = reels_mcp._sheet(clip, 6.0)
check(sheet.exists() and sheet.stat().st_size > 5_000, "contact sheet rendered", str(sheet))

text = reels_mcp._transcribe(clip)
check(text.startswith("(language:"), "Whisper transcribed on this machine's CPU/GPU", text[:200])
check((clip.parent / "transcript.txt").exists(), "transcript cached for instant repeat calls")

dur = reels_mcp._probe_duration(clip)
check(dur is not None and 5.5 < dur < 6.5, "duration probe", str(dur))

print(f"\n{'ok' if not failures else f'{failures} failed'}  (cache: {tmp})")
sys.exit(1 if failures else 0)
