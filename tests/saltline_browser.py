"""Playwright LAN smoke with desktop controls and Chromium touch emulation."""
import argparse
import json
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


def observe(page, base):
    received, sent, foreign = [], [], []
    origin = urlsplit(base).netloc

    def websocket(socket):
        if urlsplit(socket.url).netloc != origin:
            foreign.append(socket.url)
        if not socket.url.endswith("/ws/saltline"):
            return
        socket.on("framereceived", lambda frame: received.append(json.loads(frame)))
        socket.on("framesent", lambda frame: sent.append(json.loads(frame)))

    page.on("websocket", websocket)

    def route(request):
        if urlsplit(request.request.url).netloc != origin:
            foreign.append(request.request.url)
            request.abort()
        else:
            request.continue_()

    page.route("**/*", route)
    return received, sent, foreign


def wait(page, expression, timeout=120000):
    return page.wait_for_function(expression, timeout=timeout, polling=150)


def payloads(frames, kind):
    for frame in frames:
        if frame.get("t") != kind:
            continue
        payload = frame["p"]
        yield from payload if isinstance(payload, list) else [payload]


def ready(page, software):
    wait(page, "() => window.__ready || window.__fatal")
    assert page.evaluate("() => window.__ready && !window.__fatal")
    if software:
        # The CPU-only runner verifies startup drawing, then skips actual draws
        # during input and network assertions. Game logic and WebSocket stay live.
        page.evaluate("() => { window.__G.render.frame = () => {}; }")


def touch_point(locator, pointer_id=1):
    box = locator.bounding_box()
    assert box
    return {"id": pointer_id, "x": round(box["x"] + box["width"] / 2),
            "y": round(box["y"] + box["height"] / 2)}


def main(base, software, browser_name):
    with sync_playwright() as playwright:
        args = ["--no-sandbox", "--no-proxy-server", "--disable-renderer-backgrounding",
                "--disable-background-timer-throttling"]
        if software:
            args += ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
        chromium = playwright.chromium.launch(executable_path="/usr/bin/chromium", args=args)
        desktop_browser = chromium if browser_name == "chromium" else getattr(playwright, browser_name).launch()
        desktop = desktop_browser.new_context(viewport={"width": 720, "height": 420})
        phone = chromium.new_context(viewport={"width": 740, "height": 375}, is_mobile=True,
                                     has_touch=True, device_scale_factor=1)
        host, guest = desktop.new_page(), phone.new_page()
        host.set_default_timeout(60000)
        guest.set_default_timeout(60000)
        host_in, host_out, host_foreign = observe(host, base)
        guest_in, guest_out, guest_foreign = observe(guest, base)

        host.goto(base + "/")
        tile = host.locator("article").filter(has=host.get_by_role("heading", name="Saltline"))
        expect(tile).to_be_visible(timeout=20000)
        host.evaluate("() => { localStorage.setItem('hub.saltline.video.v1', '{\"fps\":30,\"scale\":0.5}'); }")
        host.goto(base + "/games/saltline/?action=host&q=low")
        ready(host, software)
        host.locator('[data-vis=public]').click()
        host.locator('[data-act=host-confirm]').click()
        wait(host, '() => window.__G.net.mode === "lobby-host"')
        code = host.evaluate("() => window.__G.net.roomCode()")
        assert code.startswith("S")
        print("Desktop opened the room from the Hub", flush=True)

        guest.goto(base + "/")
        guest.get_by_role("textbox", name="房间号").fill(code)
        guest.get_by_role("button", name="加入房间", exact=True).click()
        ready(guest, software)
        expect(guest.locator('[data-f=join-code]')).to_have_value(code)
        print("Mobile layout opened the invitation", flush=True)
        refresh = guest.locator('[data-act=lan-scan]')
        expect(refresh).to_be_enabled(timeout=25000)
        guest.on("console", lambda message: print(message.text, flush=True)
                 if message.text.startswith("[Saltline]") else None)
        refresh.tap()
        expect(guest.locator(f'.m-lan-item[data-code="{code}"]')).to_be_visible(timeout=20000)
        guest.locator('[data-act=join-confirm]').tap()
        wait(guest, '() => window.__G.net.mode === "lobby-client"')
        expect(host.locator('[data-act=mp-start]')).to_be_enabled(timeout=15000)
        host.locator('[data-act=mp-start]').click()
        for page in (host, guest):
            wait(page, '() => window.__G.game.state === "playing"')
        print("Both browsers entered the cooperative mission", flush=True)

        controls = guest.locator(".hub-touch")
        expect(controls).to_be_visible()
        for key in ("fire", "ads", "reload", "jump", "sprint", "interact", "pause"):
            expect(controls.locator(f'[data-a={key}]')).to_be_visible()
        joystick = touch_point(controls.locator(".t-stick"))
        canvas = guest.locator("#view").bounding_box()
        assert canvas
        look = {"id": 2, "x": round(canvas["x"] + canvas["width"] * .58),
                "y": round(canvas["y"] + canvas["height"] * .35)}
        fire = touch_point(controls.locator("[data-a=fire]"), 3)
        cdp = phone.new_cdp_session(guest)

        def dispatch(event, *points):
            cdp.send("Input.dispatchTouchEvent", {"type": event, "touchPoints": points})

        before = guest.evaluate("() => window.__G.camera.rotation.y")
        dispatch("touchStart", joystick, look, fire)
        dispatch("touchMove", {**joystick, "y": joystick["y"] - 36}, {**look, "x": look["x"] + 80}, fire)
        wait(guest, "() => window.__G.input.move.y > .5 && window.__G.input.fire", timeout=15000)
        assert abs(guest.evaluate("() => window.__G.camera.rotation.y") - before) > .05
        dispatch("touchEnd")
        wait(guest, "() => window.__G.input.move.y === 0 && !window.__G.input.fire", timeout=10000)
        host.keyboard.down("w")
        wait(host, "() => window.__G.input.move.y > .5", timeout=10000)
        host.keyboard.up("w")
        host.mouse.move(380, 190)
        if host.evaluate('() => window.__G.input.mode === "lock" && !window.__G.input.locked'):
            host.mouse.click(380, 190)
            wait(host, '() => window.__G.input.locked || window.__G.input.mode === "drag"', timeout=10000)
        host.mouse.down()
        wait(host, "() => window.__G.input.fire", timeout=10000)
        host.mouse.up()
        print("Three simultaneous touches and desktop movement/shooting passed", flush=True)

        guest.wait_for_timeout(800)
        for kind in ("ps", "sh"):
            assert any(part.get("k") == kind for part in payloads(guest_out, "toHost")), kind
            assert any(part.get("k") == kind for part in payloads(host_in, "toHost")), kind
        assert any(part.get("k") in {"snap", "ee"} for part in payloads(guest_in, "fromHost"))
        # Inject the result into the real host simulator to check that the guest's
        # settlement UI consumes and renders the relayed result.
        host.evaluate("""() => {
            const { net, hostSim } = window.__G;
            hostSim.onComplete({
                time: 65, accuracy: .4, kills: 3, retries: 0,
                players: net.players().map(({id, name}) => ({ id, name, kills: 0 }))
            });
        }""")
        expect(guest.get_by_role("region", name="行动简报")).to_be_visible(timeout=10000)
        expect(guest.locator('[data-f="kills"]')).to_have_text("3")
        expect(guest.locator('[data-f="team-list"]')).to_contain_text("（你）")
        assert not host_foreign and not guest_foreign, (host_foreign, guest_foreign)
        assert not host.evaluate("() => window.__errors"), host.evaluate("() => window.__errors")
        assert not guest.evaluate("() => window.__errors"), guest.evaluate("() => window.__errors")
        print("Same-origin movement, fire, enemy traffic and a controlled settlement passed", flush=True)
        desktop.close()
        phone.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("base")
    parser.add_argument("--software", action="store_true")
    parser.add_argument("--desktop", choices=("chromium", "firefox", "webkit"), default="chromium")
    arguments = parser.parse_args()
    main(arguments.base.rstrip("/"), arguments.software, arguments.desktop)
