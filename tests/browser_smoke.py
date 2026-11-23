"""Offline lobby, touch viewport, and two-browser chess acceptance checks."""
import argparse
from pathlib import Path
import re

from playwright.sync_api import expect, sync_playwright


VIEWPORTS = ((360, 800), (393, 873), (900, 400),
             (980, 420), (1280, 800), (1920, 1080))
GAMES = ("doudizhu", "guandan", "texas", "sichuan", "xiangqi", "chess",
         "spellstones", "onecard", "hexisle", "gemguild")


def browser_context(browser, base, width, height, errors):
    touch = width < 1000
    ctx = browser.new_context(viewport={"width": width, "height": height},
                              is_mobile=touch, has_touch=touch, locale="zh-CN")
    def local_only(route):
        if route.request.url.startswith(base + "/"):
            route.continue_()
        else:
            errors.append("Unexpected HTTP request: " + route.request.url)
            route.abort()
    ctx.route("**/*", local_only)
    return ctx


def assert_width(page):
    width, scroll = page.evaluate("() => [innerWidth, document.documentElement.scrollWidth]")
    assert scroll <= width + 1, (width, scroll, page.url)


def new_page(ctx, errors):
    page = ctx.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("response", lambda res: errors.append(f"{res.status} {res.url}") if res.status >= 400 else None)
    return page


def create_room(page, game="国际象棋"):
    tile = page.locator("article").filter(has=page.get_by_role("heading", name=game, exact=True))
    tile.get_by_role("button", name="联机").click()
    page.get_by_role("button", name="创建房间").click()
    expect(page.get_by_text("等待开局", exact=True)).to_be_visible()
    matched = re.search(r"/room/([A-Z0-9]{4})$", page.url)
    assert matched, page.url
    return matched.group(1)


def chess_move(page, src, dst, black=False, touch=False):
    board = page.locator(".gb.is-live")
    expect(board).to_be_visible()
    box = board.bounding_box()
    assert box
    coordinates = page.touchscreen.tap if touch else page.mouse.click
    for square in (src, dst):
        file, rank = ord(square[0]) - ord("a"), int(square[1]) - 1
        column, row = (7 - file, rank) if black else (file, 7 - rank)
        coordinates(box["x"] + box["width"] * (column + .5) / 8,
                    box["y"] + box["height"] * (row + .5) / 8)


def main(base, screenshots):
    screenshots.mkdir(parents=True, exist_ok=True)
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/usr/bin/chromium",
                                    args=["--no-sandbox", "--no-proxy-server"])
        for width, height in VIEWPORTS:
            with browser_context(browser, base, width, height, errors) as ctx:
                page = new_page(ctx, errors)
                page.goto(base)
                expect(page.get_by_role("heading", name="游戏库")).to_be_visible()
                expect(page.locator("article")).to_have_count(10)
                expect(page.locator(".hub-status")).to_contain_text("人在线")
                assert_width(page)
                page.screenshot(path=screenshots / f"lobby-{width}x{height}.png", animations="disabled")
                page.get_by_role("button", name="设置", exact=True).click()
                expect(page.get_by_role("dialog")).to_be_visible()
                assert_width(page)
                page.keyboard.press("Escape")
                expect(page.get_by_role("dialog")).to_have_count(0)
                code = create_room(page)
                assert_width(page)
                page.get_by_role("button", name="离开房间").click()
                expect(page.get_by_role("heading", name="游戏库")).to_be_visible()
                print(f"{width}×{height}: lobby, settings, create, waiting room, leave ({code})", flush=True)

        for width, height in ((360, 800), (900, 400)):
            for game in GAMES:
                with browser_context(browser, base, width, height, errors) as ctx:
                    page = new_page(ctx, errors)
                    page.goto(f"{base}/#/play/{game}")
                    expect(page.locator(".table")).to_be_visible()
                    expect(page.get_by_text("正在摆牌…", exact=True)).to_have_count(0)
                    assert_width(page)
                    page.screenshot(path=screenshots / f"{game}-{width}x{height}.png", animations="disabled")
            print(f"{width}×{height}: rendered all 10 single-player boards", flush=True)

        with browser_context(browser, base, 393, 873, errors) as c1, \
                browser_context(browser, base, 1280, 800, errors) as c2:
            a, b = new_page(c1, errors), new_page(c2, errors)
            a.goto(base + "/?hostName=Host-A")
            b.goto(base)
            expect(a.locator(".me-chip")).to_contain_text("Host-A")
            assert "hostName" not in a.url
            name_a = a.locator(".me-chip").inner_text().strip()
            name_b = b.locator(".me-chip").inner_text().strip()
            code = create_room(a)
            b.get_by_role("textbox", name="房间号").fill(code)
            b.get_by_role("button", name="加入房间").click()
            expect(b.get_by_text("等待开局", exact=True)).to_be_visible()
            a.screenshot(path=screenshots / "room-mobile.png", animations="disabled")
            a.get_by_role("button", name="开始对局").click()
            expect(b.locator(".gb")).to_be_visible()
            chess_move(a, "f2", "f3", touch=True)
            chess_move(b, "e7", "e5", black=True)
            chess_move(a, "g2", "g4", touch=True)
            chess_move(b, "d8", "h4", black=True)
            expect(a.get_by_text("你输了", exact=True)).to_be_visible()
            expect(b.get_by_text("你赢了", exact=True)).to_be_visible()
            a.screenshot(path=screenshots / "result-mobile.png", animations="disabled")
            for page in (a, b):
                page.get_by_role("button", name="返回大厅").click()
                expect(page.get_by_role("heading", name="游戏库")).to_be_visible()
            assert a.locator(".me-chip").inner_text().strip() == name_a
            assert b.locator(".me-chip").inner_text().strip() == name_b
            next_code = create_room(a, "中国象棋")
            b.get_by_role("textbox", name="房间号").fill(next_code)
            b.get_by_role("button", name="加入房间").click()
            expect(b.get_by_text("等待开局", exact=True)).to_be_visible()
            a.get_by_role("button", name="开始对局").click()
            for page in (a, b):
                expect(page.locator(".gb")).to_be_visible()
                page.get_by_role("button", name="返回", exact=True).click()
                page.get_by_role("button", name="离开", exact=True).click()
                expect(page.get_by_role("heading", name="游戏库")).to_be_visible()
            print("Two Chromium contexts: chess checkmate, lobby return, same profiles, second game", flush=True)
    assert not errors, errors
    print("No JavaScript/HTTP errors or external resource requests observed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("base")
    parser.add_argument("screenshots", type=Path)
    args = parser.parse_args()
    main(args.base.rstrip("/"), args.screenshots)
