/*
 * 實際成績（DDR WORLD 結算畫面照片：D:\iCloud Photo 與 Twitter 封存，tw: 開頭的是推文圖片）
 * mean：タイミング平均，FAST 為正、SLOW 為負（ms）
 * sd：バラつき（ms，不含 MISS）
 * marv／perf／great／good／miss：一般步的判定數；ok：freeze arrow O.K. 數；ng：freeze N.G. 數（畫面不顯示，由分數反推）
 * 每一場都用判定數反算過分數，與畫面上的分數一致
 */
(function (root) {
  'use strict';
  const PLAYS = [
    { photo: 'IMG_2947', date: '2026-02-22', song: '（不明）', mean: -1.0, sd: 16.3, marv: 534, perf: 146, great: 24, good: 0, miss: 4, ok: 20, score: 979610 },
    { photo: 'IMG_2948', date: '2026-02-22', song: 'VOLAQUAS', mean: 0, sd: 17.3, marv: 678, perf: 165, great: 32, good: 5, miss: 7, ok: 17, score: 971650 },
    { photo: 'tw:HBwNG0ZbkAArMqJ', date: '2026-02-22', song: 'BREAKING THE FUTURE', mean: 1.7, sd: 15.1, marv: 645, perf: 104, great: 24, good: 2, miss: 1, ok: 35, score: 983650 },
    { photo: 'tw:HBwNG1AagAAsTKN', date: '2026-02-22', song: 'VOLAQUAS', mean: 0.8, sd: 22.9, marv: 668, perf: 207, great: 72, good: 13, miss: 33, ok: 30, score: 926500 },
    { photo: 'tw:HBwNG1DbIAExHRv', date: '2026-02-22', song: 'IX', mean: -0.1, sd: 20.1, marv: 509, perf: 175, great: 49, good: 3, miss: 17, ok: 49, score: 949100 },
    { photo: 'IMG_3433', date: '2026-03-11', song: 'SUNKiSS♥DROP', mean: 2.7, sd: 10.2, marv: 378, perf: 44, great: 0, good: 0, miss: 0, ok: 14, score: 999560 },
    { photo: 'IMG_3434', date: '2026-03-11', song: 'Come Back To Me', mean: -0.8, sd: 13.3, marv: 407, perf: 66, great: 5, good: 1, miss: 3, ok: 8, score: 987440 },
    { photo: 'IMG_3435', date: '2026-03-11', song: 'Dance Celebration (System 7 Remix)', mean: -2.4, sd: 10.6, marv: 283, perf: 27, great: 2, good: 0, miss: 2, ok: 29, ng: 2, score: 985790 },
    { photo: 'IMG_3436', date: '2026-03-11', song: 'exotic ethnic', mean: -3.7, sd: 8.9, marv: 406, perf: 25, great: 0, good: 0, miss: 0, ok: 21, score: 999750 },
    { photo: 'IMG_3437', date: '2026-03-11', song: 'Going Hypersonic', mean: -0.1, sd: 14.8, marv: 500, perf: 73, great: 17, good: 1, miss: 4, ok: 25, score: 980380 },
    { photo: 'IMG_3438', date: '2026-03-11', song: 'blue anthem', mean: 1.2, sd: 10.6, marv: 465, perf: 43, great: 3, good: 0, miss: 0, ok: 21, score: 997280 },
    { photo: 'IMG_3551', date: '2026-03-14', song: '阿波おどり -Awaodori-', mean: -0.4, sd: 12.4, marv: 402, perf: 70, great: 2, good: 0, miss: 0, ok: 5, score: 997600 },
    { photo: 'IMG_3624', date: '2026-03-17', song: 'nightbird lost wing', mean: 0.7, sd: 12.0, marv: 433, perf: 57, great: 6, good: 0, miss: 0, ok: 17, score: 994690 },
    { photo: 'IMG_3628', date: '2026-03-17', song: 'My Drama', mean: 1.2, sd: 13.3, marv: 640, perf: 117, great: 15, good: 0, miss: 2, ok: 14, score: 988520 },
    { photo: 'IMG_3914', date: '2026-03-24', song: 'MAX 300 (Super-Max-Me Mix)', mean: 0.9, sd: 14.7, marv: 492, perf: 83, great: 10, good: 1, miss: 0, ok: 60, score: 991620 },
    { photo: 'IMG_4204', date: '2026-03-31', song: '足神様ノ復活祭', mean: 0.2, sd: 17.0, marv: 430, perf: 110, great: 33, good: 0, miss: 8, ok: 34, score: 964090 },
    { photo: 'IMG_4206', date: '2026-03-31', song: '足神様ノ復活祭', mean: 3.5, sd: 15.1, marv: 441, perf: 122, great: 17, good: 0, miss: 1, ok: 34, score: 985920 },
    { photo: 'tw:HEzJgEMaUAAr7Y3', date: '2026-04-01', song: '（DJ TOTTO）', mean: 3.5, sd: 15.3, marv: 561, perf: 129, great: 16, good: 1, miss: 5, ok: 38, score: 982270 },
    { photo: 'IMG_4584', date: '2026-04-07', song: 'Starlight Fantasia (Endorphins Mix)', mean: 0, sd: 12.2, marv: 538, perf: 73, great: 7, good: 0, miss: 0, ok: 14, score: 994760 },
    { photo: 'IMG_4775', date: '2026-04-13', song: 'Triple Journey -TAG EDITION-', mean: 4.1, sd: 12.2, marv: 518, perf: 83, great: 10, good: 0, miss: 0, ok: 11, score: 992630 },
    { photo: 'IMG_4776', date: '2026-04-13', song: 'リリーゼと炎龍レーヴァテイン', mean: -0.3, sd: 12.2, marv: 567, perf: 65, great: 9, good: 1, miss: 1, ok: 12, score: 991000 },
    { photo: 'IMG_4770', date: '2026-04-13', song: 'Nostalgia Is Lost', mean: 0.2, sd: 11.0, marv: 552, perf: 41, great: 6, good: 0, miss: 0, ok: 31, score: 995720 },
    { photo: 'IMG_4772', date: '2026-04-13', song: 'ALGORITHM', mean: -1.0, sd: 12.8, marv: 423, perf: 49, great: 5, good: 1, miss: 0, ok: 25, score: 993880 },
    { photo: 'IMG_4773', date: '2026-04-13', song: 'CHAOS Terror-Tech Mix', mean: 2.7, sd: 13.0, marv: 483, perf: 56, great: 5, good: 1, miss: 0, ok: 9, score: 994320 },
    { photo: 'IMG_4774', date: '2026-04-13', song: 'New Era', mean: 0.8, sd: 12.1, marv: 468, perf: 66, great: 8, good: 0, miss: 0, ok: 7, score: 993430 },
    { photo: 'IMG_4944', date: '2026-04-21', song: 'Chance and Dice', mean: 1.9, sd: 8.0, marv: 271, perf: 9, great: 0, good: 0, miss: 0, ok: 20, score: 999910 },
    { photo: 'IMG_4945', date: '2026-04-21', song: '朱と碧のランページ', mean: -0.5, sd: 8.8, marv: 531, perf: 25, great: 0, good: 0, miss: 0, ok: 18, score: 999750 },
    { photo: 'IMG_4946', date: '2026-04-21', song: '（jun）', mean: 3.2, sd: 13.1, marv: 430, perf: 63, great: 7, good: 1, miss: 0, ok: 27, score: 992470 },
    { photo: 'IMG_4947', date: '2026-04-21', song: 'Horatio', mean: 1.2, sd: 12.9, marv: 373, perf: 57, great: 6, good: 0, miss: 0, ok: 49, score: 994420 },
    { photo: 'IMG_4949', date: '2026-04-21', song: 'MAX 300', mean: 0.9, sd: 11.3, marv: 504, perf: 46, great: 5, good: 0, miss: 0, ok: 2, score: 995890 },
    { photo: 'IMG_4952', date: '2026-04-21', song: 'Get Your Wish', mean: 0.6, sd: 10.1, marv: 370, perf: 31, great: 0, good: 0, miss: 0, ok: 11, score: 999690 },
    { photo: 'IMG_4954', date: '2026-04-21', song: '（不明）', mean: 3.5, sd: 10.7, marv: 433, perf: 55, great: 2, good: 0, miss: 0, ok: 5, score: 997810 },
    { photo: 'IMG_4955', date: '2026-04-21', song: 'Destination', mean: -3.0, sd: 16.5, marv: 404, perf: 74, great: 18, good: 1, miss: 1, ok: 48, score: 982580 },
    { photo: 'IMG_4956', date: '2026-04-21', song: 'Destination', mean: -0.6, sd: 11.8, marv: 438, perf: 52, great: 6, good: 0, miss: 2, ok: 48, score: 991360 },
    { photo: 'IMG_4957', date: '2026-04-21', song: '（C-Show）', mean: 0.9, sd: 15.1, marv: 394, perf: 82, great: 12, good: 1, miss: 0, ok: 3, score: 987660 },
    { photo: 'IMG_4958', date: '2026-04-21', song: 'MUTEKI BUFFALO', mean: -0.8, sd: 13.6, marv: 403, perf: 80, great: 5, good: 1, miss: 0, ok: 3, score: 993440 },
    { photo: 'IMG_5238', date: '2026-04-30', song: 'The Ashes of Boreas', mean: 2.8, sd: 13.9, marv: 466, perf: 94, great: 5, good: 1, miss: 2, ok: 29, score: 990950 },
    { photo: 'IMG_5240', date: '2026-04-30', song: "Don't Stop The HYPERCORE", mean: 5.2, sd: 18.2, marv: 469, perf: 134, great: 31, good: 3, miss: 11, ok: 70, score: 962380 },
    { photo: 'IMG_5589', date: '2026-05-04', song: 'The Ashes of Boreas', mean: 4.7, sd: 13.3, marv: 463, perf: 98, great: 6, good: 1, miss: 0, ok: 29, score: 993580 },
    { photo: 'IMG_5590', date: '2026-05-04', song: 'The Ashes of Boreas', mean: 3.0, sd: 12.2, marv: 488, perf: 73, great: 7, good: 0, miss: 0, ok: 29, score: 994500 },
    { photo: 'IMG_6620', date: '2026-06-14', song: 'New Decade', mean: 1.2, sd: 14.1, marv: 412, perf: 86, great: 9, good: 0, miss: 1, ok: 40, score: 990650 },
    { photo: 'IMG_6622', date: '2026-06-14', song: 'New Decade', mean: -0.9, sd: 14.3, marv: 430, perf: 67, great: 10, good: 1, miss: 0, ok: 40, score: 990460 },
    { photo: 'IMG_6624', date: '2026-06-14', song: 'Fascination ~eternal love mix~', mean: 1.4, sd: 13.1, marv: 493, perf: 73, great: 4, good: 1, miss: 1, ok: 14, score: 993410 },
    { photo: 'tw:HK8DmgPbsAAPSPb', date: '2026-06-16', song: 'Anti-Matter', mean: 2.1, sd: 15.0, marv: 564, perf: 120, great: 14, good: 2, miss: 0, ok: 30, score: 988770 },
    { photo: 'tw:HK8DmgSaAAAhcnJ', date: '2026-06-16', song: 'DDR TAGMIX -LAST DanceR-', mean: -1.1, sd: 13.0, marv: 579, perf: 122, great: 7, good: 0, miss: 0, ok: 22, score: 994870 },
    { photo: 'tw:HK8DmgxbUAAT33p', date: '2026-06-16', song: '最速最高シャッターガール', mean: 1.7, sd: 13.7, marv: 611, perf: 96, great: 17, good: 0, miss: 2, ok: 27, score: 987180 },
    { photo: 'tw:HK8DmgyaQAA8EsT', date: '2026-06-16', song: 'ハイテックトキオ', mean: 2.9, sd: 13.5, marv: 659, perf: 119, great: 11, good: 1, miss: 2, ok: 63, score: 990260 },
    { photo: 'IMG_6787', date: '2026-06-21', song: '夏色DIARY -DDR mix-', mean: -2.5, sd: 9.2, marv: 521, perf: 42, great: 0, good: 0, miss: 0, ok: 7, score: 999580 }
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = PLAYS;
  else root.DDR_PLAYS = PLAYS;
})(this);
