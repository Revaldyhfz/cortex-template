import asyncio, sys, time
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
async def main():
    p = StdioServerParameters(command=sys.executable, args=[str(__import__("pathlib").Path(__file__).with_name("reels_mcp.py"))])
    async with stdio_client(p) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()
            tools = await s.list_tools(); print("tools:", [t.name for t in tools.tools])
            for url in sys.argv[1:]:
                t=time.time(); res = await s.call_tool("reel_read", {"url": url})
                print(f"--- {time.time()-t:.1f}s err={res.is_error}")
                for c in res.content: print(c.type, (c.text[:900] if c.type=="text" else len(c.data)))
            res = await s.call_tool("reel_frames", {"url": sys.argv[1], "start": 30, "end": 41, "count": 2})
            print("frames:", [c.type for c in res.content], res.is_error)
asyncio.run(main())
