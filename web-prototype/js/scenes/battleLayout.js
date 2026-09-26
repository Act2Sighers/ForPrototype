// 戦闘画面のステータス枠の自由配置座標を計算する純粋関数群。
// UIコード（DOM/CSS）には一切依存しない -- 人数から座標を算出する
// アルゴリズムだけを持つ（B2で実際のDOM描画に組み込む）。
//
// 全体の形は「ハの字」：画面上部中央のある1点（原点、x=0,y=0）から、
// 味方陣営の帯は左下へ、敵陣営の帯は右下へ、それぞれ扇状に開いて
// いく。各陣営の帯の中では、上から順に「中央寄り／外寄り」を交互に
// 振る（ジグザグ）ことで、隣接するステータス枠が単純なグリッドには
// スナップされていないように見せる。ジグザグの開始位相は味方と敵で
// 逆にしてあり（味方1人目＝中央寄り、敵1人目＝中央寄り）、両陣営の
// 先頭同士が向き合う対称な見た目になる。
//
// 1列のジグザグで自然に見えるのは7人程度までで、それを超えると縦に
// 伸び続けて不格好になるため、8人以上では「前後（＝奥行き＝画面の
// 縦方向）の代わりに左右方向の列を3つに増やす」形に切り替える
// （ユーザー指示）。どちらのモードでも、原点からの見かけ上の距離
// （行番号）が増えるごとに帯自体も外側へ広がっていく。
//
// 各陣営の物理的な表示上限は12体（それを超える人数は想定しない）。

// 1行あたりの縦方向の間隔。
const ROW_HEIGHT = 90;
// 原点から1行目までの縦方向のオフセット（原点ちょうどに乗せると
// 窮屈なため、少し余白を持たせる）。
const ROW_START_Y = 60;
// 行番号が1増えるごとに、帯の中心線（スパイン）が外側へ広がる量。
const BAND_DX_PER_ROW = 70;
// ジグザグモード（1列）での、中央寄り/外寄りの振れ幅。
const ZIGZAG_OFFSET = 36;
// 複数列モードでの、隣接するレーン同士の間隔。
const LANE_GAP = 100;
// この人数を超えたら1列のジグザグから3列モードへ切り替える。
const MULTI_COLUMN_THRESHOLD = 7;
// 3列モードで使う列数。
const WIDE_COLUMN_COUNT = 3;
// 各陣営の物理的な表示上限（このファイルの関数自体はこれを超える
// 人数を渡されても計算は続けるが、呼び出し側はこれを超える人数を
// 生成しない前提）。
export const MAX_UNITS_PER_FACTION = 12;

// faction（"ally"|"enemy"）とその陣営の人数から、原点(0,0)を基準にした
// 各ユニットの{x,y}座標を、渡された配列の並び順（0番目が最も原点に
// 近い＝1行目）のまま返す。呼び出し側は、実際の画面上の原点位置
// （アリーナ上部中央のどこか）だけ決めて平行移動すればよい。
export function computeUnitPositions(faction, count) {
  if (count <= 0) return [];
  // 味方の帯は左下（x軸負方向）へ、敵の帯は右下（x軸正方向）へ開く。
  const sideSign = faction === "ally" ? -1 : 1;
  const columns = count > MULTI_COLUMN_THRESHOLD ? WIDE_COLUMN_COUNT : 1;
  const positions = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / columns);
    const laneInRow = i % columns;
    // 最終行は列数に満たない場合があるので、その行に実際に並ぶレーン数
    // を別途数え、中央揃えでレーンを配置する。
    const lanesInThisRow = Math.min(columns, count - row * columns);
    const y = ROW_START_Y + row * ROW_HEIGHT;
    const spineX = sideSign * BAND_DX_PER_ROW * row;

    let x;
    if (columns === 1) {
      // ジグザグモード：行が偶数なら中央寄り、奇数なら外寄り。敵は
      // 位相を反転させ、両陣営の1行目同士が向き合う対称な形にする。
      const zigzagSign = row % 2 === 0 ? 1 : -1;
      const phaseFlip = faction === "enemy" ? -1 : 1;
      x = spineX + zigzagSign * phaseFlip * ZIGZAG_OFFSET;
    } else {
      // 複数列モード：その行のレーン数に応じて中央揃えで左右に開く。
      // sideSignを掛けることで、ジグザグモードと同じく味方・敵が原点
      // 対称になるようにする（laneInRow=0が外側、最後のレーンが中央側）。
      const laneOffsetFromCenter = laneInRow - (lanesInThisRow - 1) / 2;
      x = spineX + sideSign * laneOffsetFromCenter * LANE_GAP;
    }
    positions.push({ x, y });
  }
  return positions;
}

// 味方・敵両陣営分をまとめて計算し、原点からの相対座標をそのまま
// 返す（{ally: [...], enemy: [...]}）。B2でDOM上に配置する際、この
// 座標群全体のbounding boxから必要なキャンバスサイズを逆算する想定。
export function computeBattleLayout(allyCount, enemyCount) {
  return {
    ally: computeUnitPositions("ally", allyCount),
    enemy: computeUnitPositions("enemy", enemyCount),
  };
}
