"""Complete a timed snake match with real touch and keyboard clients."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright
from browser_smoke import browser_context, new_page


def track(page, incoming, outgoing):
    def pipe(ws):
        def record(frames, payload):
            try:
                message = json.loads(payload)
                if message.get("t") != "hello":
                    frames.append(message)
            except (ValueError, TypeError):
                pass
        ws.on("framereceived", lambda payload: record(incoming, payload))
        ws.on("framesent", lambda payload: record(outgoing, payload))
    page.on("websocket", pipe)


def game_frames(frames):
    return [frame for frame in frames if frame.get("t") == "game"
            and isinstance(frame.get("view"), dict) and "snakes" in frame["view"]]


def pick_point(locator, dx=0, dy=0, pointer_id=0):
    box = locator.bounding_box()
    assert box, locator
    return {"x": round(box["x"] + box["width"] / 2 + dx),
            "y": round(box["y"] + box["height"] / 2 + dy), "id": pointer_id}


def main(base, screenshots):
    screenshots.mkdir(parents=True, exist_ok=True)
    errors = []
    received = [[], []]
    sent = [[], []]
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path="/usr/bin/chromium",
                                              args=["--no-sandbox", "--no-proxy-server"])
        with browser_context(browser, base, 360, 800, errors) as portrait, \
                browser_context(browser, base, 900, 400, errors) as landscape:
            host, guest = new_page(portrait, errors), new_page(landscape, errors)
            for index, page in enumerate((host, guest)):
                track(page, received[index], sent[index])
                page.goto(base)
            tile = host.locator("article").filter(has=host.get_by_role("heading", name="流光蛇场"))
            tile.get_by_role("button", name="联机").click()
            host.get_by_role("radio", name="30 秒", exact=True).click()
            host.get_by_role("button", name="创建房间").click()
            expect(host.get_by_text("等待开局", exact=True)).to_be_visible()
            code = host.url.rsplit("/", 1)[1]
            guest.get_by_role("textbox", name="房间号").fill(code)
            guest.get_by_role("button", name="加入房间").click()
            expect(guest.get_by_text("等待开局", exact=True)).to_be_visible()
            host.get_by_role("button", name="开始对局").click()

            joystick = host.get_by_role("button", name="方向摇杆")
            boost = host.get_by_role("button", name="按住加速")
            expect(joystick).to_be_enabled()
            expect(guest.get_by_role("button", name="按住加速")).to_be_enabled()
            for page, name in ((host, "portrait"), (guest, "landscape")):
                for locator in (page.locator(".lumen-canvas"), page.get_by_role("button", name="按住加速")):
                    box = locator.bounding_box()
                    assert box and box["y"] >= 0 and box["x"] >= 0
                    viewport = page.viewport_size
                    assert box["x"] + box["width"] <= viewport["width"] + 1
                    assert box["y"] + box["height"] <= viewport["height"] + 1
                canvas = page.locator(".lumen-canvas").bounding_box()
                rank = page.get_by_role("complementary", name="实时排行榜").bounding_box()
                assert canvas and rank
                assert canvas["width"] == page.viewport_size["width"], canvas
                assert canvas["height"] == page.viewport_size["height"], canvas
                assert rank["y"] < 90 and rank["x"] + rank["width"] > canvas["width"] - 30, rank
                page.screenshot(path=screenshots / f"snake-{name}.png")

            host_frame = game_frames(received[0])[-1]
            player = host_frame["view"]["snakes"][0]
            head = player["cells"][0]
            if player["heading"] in ("east", "west"):
                direction, dx, dy = ("south", 0, 24) if head // 64 < 16 else ("north", 0, -24)
            else:
                direction, dx, dy = ("east", 24, 0) if head % 64 < 32 else ("west", -24, 0)
            cdp = portrait.new_cdp_session(host)
            cdp.send("Input.dispatchTouchEvent", {"type": "touchStart",
                     "touchPoints": [pick_point(joystick, pointer_id=1), pick_point(boost, pointer_id=2)]})
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove",
                     "touchPoints": [pick_point(joystick, dx, dy, 1), pick_point(boost, pointer_id=2)]})
            expect(boost).to_have_attribute("aria-pressed", "true")
            guest.keyboard.press("ArrowLeft")
            expect(host.get_by_label("开局倒计时")).to_have_count(0, timeout=5000)
            host.wait_for_timeout(340)
            cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
            expect(boost).to_have_attribute("aria-pressed", "false")
            host.wait_for_timeout(140)
            assert any(msg.get("action", {}).get("direction") == direction for msg in sent[0]), sent[0]
            assert any(msg.get("action", {}).get("boost") is True for msg in sent[0]), sent[0]
            assert any(msg.get("action", {}).get("boost") is False for msg in sent[0]), sent[0]
            assert any(msg.get("action", {}).get("direction") == "west" for msg in sent[1]), sent[1]

            emitted = {(msg["matchNo"], msg["version"]): msg["view"] for msg in game_frames(received[0])}
            assert any(msg["view"]["snakes"][0]["boosted"] for msg in game_frames(received[0]))
            synchronized = [msg for msg in game_frames(received[1])
                            if (msg["matchNo"], msg["version"]) in emitted and msg["view"]["tick"] > 25]
            assert synchronized
            for msg in synchronized:
                assert msg["view"] == emitted[(msg["matchNo"], msg["version"])]
            guest.get_by_role("button", name="进入全屏").click()
            expect(guest.get_by_role("button", name="退出全屏")).to_be_visible()
            assert guest.evaluate("document.fullscreenElement?.classList.contains('table--arena')")
            guest.get_by_role("button", name="退出全屏").click()
            expect(guest.get_by_role("button", name="进入全屏")).to_be_visible()
            guest.reload()
            expect(guest.locator(".lumen-canvas")).to_be_visible()
            previous = game_frames(received[1])[-1]
            assert previous["seat"] == 1 and previous["matchNo"] == host_frame["matchNo"]

            for page in (host, guest):
                expect(page.get_by_role("heading", name="蛇场结算")).to_be_visible(timeout=40000)
            host.screenshot(path=screenshots / "snake-result.png", animations="disabled")
            assert game_frames(received[0])[-1]["view"] == game_frames(received[1])[-1]["view"]
            for page in (host, guest):
                page.get_by_role("button", name="返回大厅").click()
                expect(page.get_by_role("heading", name="游戏库")).to_be_visible()
    assert not errors, errors
    print("Snake: portrait + landscape, multi-touch joystick + boost, keyboard, shared ticks, reconnect, result, lobby")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("base")
    parser.add_argument("screenshots", type=Path)
    args = parser.parse_args()
    main(args.base.rstrip("/"), args.screenshots)
