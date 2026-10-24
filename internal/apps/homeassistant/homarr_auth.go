package homeassistant

const homarrAuthScript = `import asyncio, json, os, re
import aiohttp

base = "http://127.0.0.1:8123"
client = base + "/"
username = "self-host-homarr"
name = "self-host Homarr"
group = ["system-read-only"]
result = {"status": "failed"}

class Manual(Exception):
    pass

class Unsupported(Exception):
    pass

async def request(session, method, path, **kwargs):
    async with session.request(method, base + path, allow_redirects=False, **kwargs) as response:
        if response.status not in (200, 201):
            if response.status in (400, 401, 403):
                raise Manual()
            raise RuntimeError()
        return await response.json()

async def login(session, user, password, refreshes):
    flow = await request(session, "POST", "/auth/login_flow", json={
        "client_id": client, "redirect_uri": client, "handler": ["homeassistant", None]})
    if flow.get("type") != "form" or not flow.get("flow_id"):
        raise Manual()
    entry = await request(session, "POST", "/auth/login_flow/" + flow["flow_id"], json={
        "client_id": client, "username": user, "password": password})
    if entry.get("type") != "create_entry" or not entry.get("result"):
        raise Manual()
    tokens = await request(session, "POST", "/auth/token", data={
        "grant_type": "authorization_code", "code": entry["result"], "client_id": client})
    if not tokens.get("refresh_token") or not tokens.get("access_token") or tokens.get("token_type") != "Bearer":
        raise Manual()
    refreshes.append(tokens["refresh_token"])
    return tokens["access_token"]

async def connect(session, token):
    ws = await session.ws_connect(base + "/api/websocket")
    try:
        welcome = await ws.receive_json()
        found = re.match(r"(\d+)\.(\d+)\.(\d+)", str(welcome.get("ha_version")))
        if not found or tuple(int(part) for part in found.groups()) < (2026, 9, 3):
            raise Unsupported()
        if welcome.get("type") != "auth_required":
            raise Manual()
        await ws.send_json({"type": "auth", "access_token": token})
        if (await ws.receive_json()).get("type") != "auth_ok":
            raise Manual()
        return ws
    except Exception:
        await ws.close()
        raise

async def command(ws, kind, **kwargs):
    command.counter += 1
    await ws.send_json({"id": command.counter, "type": kind, **kwargs})
    response = await ws.receive_json()
    if response.get("id") != command.counter or response.get("type") != "result" or response.get("success") is not True:
        raise Manual()
    return response.get("result")

command.counter = 0

async def token_metadata(ws, user_id):
    user = await command(ws, "auth/current_user")
    if user.get("id") != user_id or user.get("is_admin") is not False or user.get("is_owner") is not False:
        raise Manual()
    tokens = await command(ws, "auth/refresh_tokens")
    current = [t for t in tokens if t.get("is_current") is True]
    if len(current) != 1 or current[0].get("type") != "long_lived_access_token" or current[0].get("client_name") != name or not current[0].get("id"):
        raise Manual()
    return current[0]["id"]

async def main():
    refreshes = []
    sockets = []
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as session:
        try:
            owner = await login(session, os.environ["SELF_HOST_ADMIN_USER"], os.environ["SELF_HOST_ADMIN_PASSWORD"], refreshes)
            admin = await connect(session, owner)
            sockets.append(admin)
            users = await command(admin, "config/auth/list")
            user_id = os.environ["SELF_HOST_USER_ID"]
            matches = [u for u in users if u.get("id") == user_id]
            if user_id:
                if len(matches) != 1:
                    raise Manual()
                user = matches[0]
                if user.get("name") != name or user.get("username") not in (None, username) or user.get("is_owner") is not False or user.get("is_active") is not True or user.get("system_generated") is not False or user.get("group_ids") != group or user.get("local_only") is not True:
                    raise Manual()
            else:
                if os.environ["SELF_HOST_MODE"] != "ensure" or any(u.get("username") == username or u.get("name") == name for u in users):
                    raise Manual()
                user = (await command(admin, "config/auth/create", name=name, group_ids=group, local_only=True))["user"]
                user_id = user["id"]
                result["user_id"] = user_id
            token = os.environ["SELF_HOST_TOKEN"]
            token_id = os.environ["SELF_HOST_TOKEN_ID"]
            if os.environ["SELF_HOST_MODE"] == "verify":
                reader = await connect(session, token)
                sockets.append(reader)
                actual_id = await token_metadata(reader, user_id)
                if actual_id != token_id:
                    raise Manual()
            else:
                if user.get("username") is None:
                    await command(admin, "config/auth_provider/homeassistant/create", user_id=user_id, username=username, password=os.environ["SELF_HOST_PASSWORD"])
                access = await login(session, username, os.environ["SELF_HOST_PASSWORD"], refreshes)
                reader = await connect(session, access)
                sockets.append(reader)
                current = await command(reader, "auth/current_user")
                if current.get("id") != user_id or current.get("is_admin") is not False or current.get("is_owner") is not False:
                    raise Manual()
                tokens = await command(reader, "auth/refresh_tokens")
                named = [t for t in tokens if t.get("client_name") == name and t.get("type") == "long_lived_access_token"]
                if named:
                    if len(named) != 1 or not token:
                        raise Manual()
                else:
                    token = await command(reader, "auth/long_lived_access_token", client_name=name, lifespan=365)
                    result["token"] = token
                verified = await connect(session, token)
                sockets.append(verified)
                actual_id = await token_metadata(verified, user_id)
            result.update(status="ok", user_id=user_id, token_id=actual_id)
        finally:
            for ws in sockets:
                await ws.close()
            for refresh in refreshes:
                try:
                    async with session.post(base + "/auth/revoke", data={"token": refresh}, allow_redirects=False) as response:
                        if response.status != 200:
                            result["status"] = "failed"
                except Exception:
                    result["status"] = "failed"

try:
    async def bounded():
        async with asyncio.timeout(50):
            await main()
    asyncio.run(bounded())
except Manual:
    result["status"] = "manual"
except Unsupported:
    result["status"] = "unsupported"
except Exception:
    result["status"] = "failed"
print(json.dumps(result))
`
