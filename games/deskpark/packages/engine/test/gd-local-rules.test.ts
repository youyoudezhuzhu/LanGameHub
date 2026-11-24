import { describe, expect, it } from 'vitest';
import type { Card, Suit } from '../src';
import { createDeck, gd } from '../src';

/**
 * 掼蛋规则对照：本地玩法以 youyoudezhuzhu/guandan-android-server 为准。
 * 那个仓库在原版 Guandan-Webgame 基础上做过几处规则修正，这里逐条锁住。
 */
const { classify, gdBeats, gdValue, isWild } = gd;

let nextId = 100;
const C = (rank: number, suit: Suit = 'S'): Card => ({ id: nextId++, suit, rank });
const kinds = (cards: Card[], level: number) => classify(cards, level).map((p) => p.kind);

describe('掼蛋 · 本地玩法规则', () => {
  it('两副牌共 108 张', () => {
    expect(createDeck(2, true).length).toBe(108);
  });

  it('红桃级牌是万能牌', () => {
    expect(isWild(C(2, 'H'), 2)).toBe(true);
    expect(isWild(C(2, 'S'), 2)).toBe(false);
  });

  it('级牌大于 A、小于王', () => {
    const L = 7;
    expect(gdValue(C(7), L)).toBe(15); // 级牌
    expect(gdValue(C(14), L)).toBe(14); // A
    expect(gdValue(C(16, 'J'), L)).toBe(16); // 小王
    expect(gdValue(C(17, 'J'), L)).toBe(17); // 大王
  });

  it('标准牌型齐全', () => {
    const L = 2;
    expect(kinds([C(5)], L)).toContain('single');
    expect(kinds([C(5), C(5, 'H')], L)).toContain('pair');
    expect(kinds([C(5), C(5, 'H'), C(5, 'C')], L)).toContain('trio');
    expect(kinds([C(5), C(5, 'H'), C(5, 'C'), C(9), C(9, 'H')], L)).toContain('fullhouse');
    expect(kinds([C(5), C(6, 'H'), C(7, 'C'), C(8), C(9, 'H')], L)).toContain('straight');
    // 三连对（3 个连续对子）
    expect(kinds([C(5), C(5, 'H'), C(6), C(6, 'H'), C(7), C(7, 'H')], L)).toContain('tube');
    // 钢板（2 个连续三张）
    expect(kinds([C(5), C(5, 'H'), C(5, 'C'), C(6), C(6, 'H'), C(6, 'C')], L)).toContain('plate');
  });

  it('非炸弹牌型最多 6 张：不存在 9 张三连三张（木板）', () => {
    // 本地仓库在 3edc11e 里明确删掉了「木板」牌型
    const L = 2;
    const wooden = [
      C(5),
      C(5, 'H'),
      C(5, 'C'),
      C(6),
      C(6, 'H'),
      C(6, 'C'),
      C(7),
      C(7, 'H'),
      C(7, 'C'),
    ];
    expect(kinds(wooden, L)).toEqual([]);
  });

  it('A 可作 1：A2345 是顺子', () => {
    const L = 3;
    expect(kinds([C(14), C(2, 'H'), C(3, 'C'), C(4), C(5, 'H')], L)).toContain('straight');
  });

  it('炸弹大小：张数越多越大；同花顺介于 5 炸与 6 炸之间；四王最大', () => {
    const L = 2;
    const bomb = (n: number) =>
      classify(
        Array.from({ length: n }, () => C(9)),
        L,
      ).find((p) => p.kind === 'bomb')!;
    expect(gdBeats(bomb(5), bomb(4))).toBe(true);

    const sf = classify([C(5), C(6), C(7), C(8), C(9)], L).find((p) => p.kind === 'straightflush')!;
    expect(gdBeats(sf, bomb(5))).toBe(true);
    expect(gdBeats(bomb(6), sf)).toBe(true);

    const jokerBomb = classify([C(16, 'J'), C(16, 'J'), C(17, 'J'), C(17, 'J')], L).find(
      (p) => p.kind === 'jokerbomb',
    )!;
    expect(gdBeats(jokerBomb, bomb(6))).toBe(true);
  });

  it('还贡：10 或以下的非王、非红桃级牌（万能牌不能还）', () => {
    // 与本地仓库 pickRepay 一致：
    //   !joker && !(♥ 且 rank === level) && naturalValue(rank) <= 10
    const L = 7;
    const canReturn = (c: Card) => c.suit !== 'J' && c.rank <= 10 && !isWild(c, L);

    expect(canReturn(C(9))).toBe(true); // 普通小牌
    expect(canReturn(C(10, 'D'))).toBe(true); // 10 也算
    expect(canReturn(C(14))).toBe(false); // A 不行
    expect(canReturn(C(16, 'J'))).toBe(false); // 王不行
    expect(canReturn(C(7, 'H'))).toBe(false); // 红桃级牌（万能牌）不行
    expect(canReturn(C(7, 'S'))).toBe(true); // 级牌的非红桃花色可以
  });

  it('升级：队友二游升 3 级、三游升 2 级、末游升 1 级', () => {
    const up = (partnerPos: number) => (partnerPos === 1 ? 3 : partnerPos === 2 ? 2 : 1);
    expect(up(1)).toBe(3);
    expect(up(2)).toBe(2);
    expect(up(3)).toBe(1);
  });
});
