import httpx
import asyncio

async def main():
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post("https://n8n.nik-server.in/webhook/kt-chatbot", json={})
            print("Status code:", response.status_code)
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    asyncio.run(main())

