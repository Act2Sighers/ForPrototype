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

// ステータス枠1つぶんの想定サイズ（B2でDOM実測した値を丸めたもの、
// 220px幅なら1行に収まって93px高になる）。行間・レーン間の間隔は
// これに余白を足して逆算し、枠同士が重ならないようにしてある。
export const CARD_WIDTH = 220;
export const CARD_HEIGHT = 100;
// 行間・レーン間それぞれに足す余白。
const ROW_GAP = 30;
const LANE_SPACING_GAP = 40;

// 1行あたりの縦方向の間隔（枠の高さ＋余白）。
const ROW_HEIGHT = CARD_HEIGHT + ROW_GAP;
// 原点から1行目までの縦方向のオフセット（「ハの字」の先端が原点付近に
// 収束して見えるよう、多少の余白を持たせてある）。
const ROW_START_Y = 90;
// ジグザグモード（1列）：偶数行を「近レーン」・奇数行を「遠レーン」の
// 2本のレーンとして扱う（ユーザー提示のモックアップに合わせた設計 --
// 詳しくはcomputeUnitPositionsのコメント参照）。近レーンの原点からの
// 開き幅、2行進むごとに両レーンとも外側へ広がる量、近→遠レーンの
// 固定の開き幅、をそれぞれ独立した定数として持つ。
const ZIGZAG_BASE_HALF_GAP = 190;
const ZIGZAG_STEP_PER_PAIR = 50;
const ZIGZAG_LANE_GAP = 120;
// 複数列モードでの、隣接するレーン同士の間隔（枠の幅＋余白）。
const LANE_GAP = CARD_WIDTH + LANE_SPACING_GAP;
// 原点からの帯の基本の開き幅（複数列モードの基準スパイン位置）。
const BASE_HALF_GAP = 170;
// 複数列モードで、行番号が1増えるごとに帯の中心線（スパイン）が外側へ
// 広がる量。
const MULTI_COLUMN_BAND_DX_PER_ROW = 70;
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
    const y = ROW_START_Y + row * ROW_HEIGHT;

    let x;
    if (columns === 1) {
      // ジグザグモード：偶数行＝「近レーン」・奇数行＝「遠レーン」の
      // 2本のレーンが独立して存在すると考える（ユーザー提示のモック
      // アップに基づく設計）。どちらのレーンも2行進む（＝同じレーンで
      // 1つ奥へ進む）ごとにZIGZAG_STEP_PER_PAIRぶん外側へ広がり、遠
      // レーンは近レーンより常にZIGZAG_LANE_GAPぶん外側にある。
      // 隣り合う行が別レーンに属する固定の開き幅（ZIGZAG_LANE_GAP）で
      // 常に離れるため、「奇数行→偶数行」の広がり幅（-ZIGZAG_LANE_GAP+
      // ZIGZAG_STEP_PER_PAIR）が小さくなりすぎて隣接2行がほぼ重なって
      // 見えてしまう、という旧アルゴリズムの問題を構造的に避けられる
      // （ZIGZAG_LANE_GAP≫ZIGZAG_STEP_PER_PAIRである限り常に成立）。
      // 両陣営とも同じ規則（偶数行＝近、奇数行＝遠）を使うため、旧来の
      // ような敵側の位相反転は不要 -- 両陣営の同じ行番号同士が同じ
      // レーン扱いになり、モックアップ通り左右対称になる。
      const pairIndex = Math.floor(row / 2);
      const isFarLane = row % 2 === 1;
      const offset = ZIGZAG_BASE_HALF_GAP + pairIndex * ZIGZAG_STEP_PER_PAIR + (isFarLane ? ZIGZAG_LANE_GAP : 0);
      x = sideSign * offset;
    } else {
      // 複数列モード：BASE_HALF_GAPを基本の開き幅として、行が進むごとに
      // さらに外側へ広げる。レーンを中央揃えにはせず、スパインから常に
      // 外側（中心から遠ざかる方向）へだけ積み増していく。中央揃えに
      // すると、内側のレーンが中心線を越えて相手陣営側へはみ出しうる
      // （BASE_HALF_GAPより複数レーン分の半幅の方が大きくなるため）。
      // 外側だけに積むことで、スパイン自体が確保する中心からの間隔
      // （BASE_HALF_GAP起点）を常に下回らないようにしている。
      const spineX = sideSign * (BASE_HALF_GAP + MULTI_COLUMN_BAND_DX_PER_ROW * row);
      x = spineX + sideSign * laneInRow * LANE_GAP;
    }
    positions.push({ x, y });
  }
  return positions;
}

// 陣営の縦方向の中心（bounding boxの中点）。空配列（0人）ならoutil。
function verticalCenterOf(points) {
  const minY = Math.min(...points.map((p) => p.y)) - CARD_HEIGHT / 2;
  const maxY = Math.max(...points.map((p) => p.y)) + CARD_HEIGHT / 2;
  return (minY + maxY) / 2;
}

// 味方・敵両陣営分をまとめて計算し、原点からの相対座標をそのまま
// 返す（{ally: [...], enemy: [...]}）。B2でDOM上に配置する際、この
// 座標群全体のbounding boxから必要なキャンバスサイズを逆算する想定。
//
// 人数が陣営間で大きく異なる（例：1列ジグザグの6人 vs 3列モードの
// 12人）と、どちらも1行目はy=ROW_START_Yで揃っているのに全体の縦の
// 深さ（行数×ROW_HEIGHT）が陣営ごとに違うため、単純にそのまま並べる
// と「浅い方の陣営の中心が、深い方の陣営の中心より原点に近い（＝上に
// 来る）」というズレが生じる（ユーザー指摘）。ここで、より深い方の
// 陣営はそのまま（1行目が原点付近という基準を保つ）にし、浅い方の
// 陣営だけを縦方向にシフトして、両陣営のbounding box中心のy座標を
// 一致させる（浅い方を必ず下へ動かすだけで、上方向＝原点寄りへ動かす
// ことはない＝中央のフェイズ表示と重なる心配が無い）。
export function computeBattleLayout(allyCount, enemyCount) {
  const ally = computeUnitPositions("ally", allyCount);
  const enemy = computeUnitPositions("enemy", enemyCount);
  if (ally.length > 0 && enemy.length > 0) {
    const delta = verticalCenterOf(ally) - verticalCenterOf(enemy);
    if (delta > 0) for (const p of enemy) p.y += delta;
    else if (delta < 0) for (const p of ally) p.y -= delta;
  }
  return { ally, enemy };
}

// computeBattleLayoutの結果全体を収める、原点(0,0)基準のbounding box。
// 各ユニット枠の実サイズ（CARD_WIDTH/CARD_HEIGHT）ぶんの余白を含める。
// 中央のフェイズ表示（ターン数・フェイズ名・vs・実行ボタン）はもはや
// キャンバス内の論理座標に配置せず、.battle-arena-scroll側に画面中央
// 固定のオーバーレイとして独立に重ねているため、ここでその分の余白を
// 確保する必要は無い。呼び出し側は、返り値のminX/minYの符号を反転
// させた量だけ全座標を平行移動すれば、そのままキャンバスの左上を原点
// にできる（width/heightがキャンバス自体に必要なピクセルサイズになる）。
export function computeCanvasBounds(layout) {
  const points = [...layout.ally, ...layout.enemy];
  const minX = Math.min(...points.map((p) => p.x)) - CARD_WIDTH / 2;
  const maxX = Math.max(...points.map((p) => p.x)) + CARD_WIDTH / 2;
  const minY = Math.min(...points.map((p) => p.y)) - CARD_HEIGHT / 2;
  const maxY = Math.max(...points.map((p) => p.y)) + CARD_HEIGHT / 2;

  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}
