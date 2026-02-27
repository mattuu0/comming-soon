// ============================================================
//  Matter.js を使った文字物理演出
//  ダブルクリックで文字を元の位置にリセットできます
//  CONFIG.zeroGravity を true にすると無重力モードで起動します
// ============================================================

const { Engine, Render, Runner, Bodies, Body, World, Mouse, MouseConstraint, Events } = Matter;

// ============================================================
//  ▼ カスタマイズ定数（ここを変えるだけで挙動を調整できます）
// ============================================================
const CONFIG = {
    // --- フォント ---
    fontFamily:      '"Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", "BIZ UDPGothic", Meiryo, sans-serif',
    fontSizeScale:   1.0,   // 元のフォントサイズに掛ける倍率（大きくするほど文字が大きい）

    // --- 物理パラメータ ---
    gravity:         1.2,   // 通常時の重力の強さ（大きいほど速く落ちる）
    restitution:     0.35,  // 反発係数（0〜1、大きいほどよく跳ねる）
    friction:        0.01,  // 摩擦係数（大きいほど滑りにくい）
    frictionAir:     0.015, // 空気抵抗（大きいほど早く止まる）
    frictionAirZero: 0.01,  // 無重力時の空気抵抗（少し大きくしてふわっと漂わせる）
    density:         0.003, // 密度（大きいほど重くなる）

    // --- 無重力モード ---
    zeroGravity:     true, // true にすると最初から無重力で起動する
    scatterForce:    0.05, // 無重力開始時に与える拡散力（大きいほど勢いよく散らばる）
    scatterSpin:     0.1,   // 無重力開始時に与えるランダム回転の強さ

    // --- マウス ---
    mouseStiffness:  0.2,   // ドラッグのバネ強さ（0〜1、小さいほどふわっと動く）

    // --- 壁 ---
    wallThickness:   80,    // 壁・地面・天井の厚さ（px）

    // --- アニメーション ---
    fadeInDelay:     0,  // フェードイン後、物理演出を開始するまでの待機時間（ms）

    // --- デバッグ ---
    debug:           false, // true にするとボディの輪郭を表示（確認後は false に）
    debugOpacity:    0.75,  // デバッグ表示の透明度
};
// ============================================================


function init() {

    // ── DOM要素の取得 ────────────────────────────────────────
    const h1El      = document.querySelector('h1');
    const pEl       = document.querySelector('.jp-sub-text');
    const container = document.querySelector('.container');

    // テキスト内容を保持（後でDOM非表示にするため先に取得）
    const h1Text = h1El ? h1El.textContent : '';
    const pText  = pEl  ? pEl.textContent  : '';


    // ── Matter.js エンジン初期化 ─────────────────────────────
    const engine = Engine.create({
        gravity: { x: 0, y: CONFIG.zeroGravity ? 0 : CONFIG.gravity },
    });
    const world = engine.world;


    // ── 壁・地面・天井の生成 ─────────────────────────────────
    // リサイズ時に作り直すため配列で管理する
    let walls = [];

    function createWalls() {
        // 既存の壁をワールドから削除
        walls.forEach(w => World.remove(world, w));

        const W = window.innerWidth;
        const H = window.innerHeight;
        const T = CONFIG.wallThickness;

        walls = [
            Bodies.rectangle(W / 2,     H + T / 2, W * 3, T,     { isStatic: true, label: 'wall-floor'   }),
            Bodies.rectangle(W / 2,     -T / 2,    W * 3, T,     { isStatic: true, label: 'wall-ceiling' }),
            Bodies.rectangle(-T / 2,    H / 2,     T,     H * 3, { isStatic: true, label: 'wall-left'    }),
            Bodies.rectangle(W + T / 2, H / 2,     T,     H * 3, { isStatic: true, label: 'wall-right'   }),
        ];
        World.add(world, walls);
    }
    createWalls();


    // ── デバッグレンダラー（CONFIG.debug が true のとき有効） ──
    let debugRender = null;

    function setupDebugRenderer() {
        if (!CONFIG.debug) return;

        debugRender = Render.create({
            element: document.body,
            engine,
            options: {
                width:               window.innerWidth,
                height:              window.innerHeight,
                background:          'transparent',
                wireframeBackground: 'transparent',
                wireframes:          true,  // ワイヤーフレーム表示
                showVelocity:        true,  // 速度ベクトルを表示
                showIds:             false,
            },
        });
        debugRender.canvas.style.cssText = `
            position: fixed;
            top: 0; left: 0;
            pointer-events: none;
            z-index: 101;
            opacity: ${CONFIG.debugOpacity};
        `;
        Render.run(debugRender);
    }
    setupDebugRenderer();


    // ── 文字 span を載せるコンテナ ──────────────────────────
    // position: fixed の原点コンテナ（中身は overflow: visible で画面全体に広がる）
    const charContainer = document.createElement('div');
    charContainer.style.cssText = `
        position: fixed;
        top: 0; left: 0;
        width: 0; height: 0;
        overflow: visible;
        pointer-events: none;
        z-index: 100;
    `;
    document.body.appendChild(charContainer);

    // span のサイズを事前計測するための非表示コンテナ
    const measureContainer = document.createElement('div');
    measureContainer.style.cssText = `
        position: fixed;
        top: -9999px; left: -9999px;
        visibility: hidden;
        pointer-events: none;
    `;
    document.body.appendChild(measureContainer);


    // ── 文字サイズの計測 ──────────────────────────────────
    // 各文字を一時的にDOMに追加して getBoundingClientRect で実寸を取得する
    // Canvas による計測より正確で、カーニングも反映される
    function measureChars(text, fontSize, fontWeight) {
        return text.split('').map(char => {
            // スペースは計測できないので概算値を返す
            if (char === ' ') return { char, w: fontSize * 0.4, h: fontSize };

            const s = document.createElement('span');
            s.textContent = char;
            s.style.cssText = `
                font-size: ${fontSize}px;
                font-weight: ${fontWeight};
                font-family: ${CONFIG.fontFamily};
                line-height: 1;
                white-space: pre;
                display: inline-block;
            `;
            measureContainer.appendChild(s);
            const rect = s.getBoundingClientRect();
            measureContainer.removeChild(s);

            return { char, w: rect.width, h: rect.height };
        });
    }


    // ── 文字ボディ & span の生成 ─────────────────────────────
    // sourceEl の位置・スタイルを元に、1文字ずつ物理ボディとDOMを作る
    const charEntries = []; // { body, span, charW, charH }

    function addTextBodies(text, sourceEl) {
        if (!sourceEl) return;

        const sourceRect    = sourceEl.getBoundingClientRect();
        const baseFontSize  = parseFloat(window.getComputedStyle(sourceEl).fontSize);
        const fontSize      = baseFontSize * CONFIG.fontSizeScale; // スケール適用
        const fontWeight    = window.getComputedStyle(sourceEl).fontWeight;
        const letterSpacing = parseFloat(window.getComputedStyle(sourceEl).letterSpacing) || 0;
        const color         = window.getComputedStyle(sourceEl).color;

        // 全文字のサイズを計測
        const measured = measureChars(text, fontSize, fontWeight);

        // テキスト全体を水平中央に配置するための開始X座標を計算
        const totalWidth = measured.reduce((sum, m) => sum + m.w + letterSpacing, 0);
        let cursorX = sourceRect.left + (sourceRect.width - totalWidth) / 2;
        const centerY = sourceRect.top + sourceRect.height / 2;

        measured.forEach(({ char, w, h }) => {
            const x = cursorX + w / 2; // 文字の中心X

            if (char !== ' ') {
                const charW = w;
                const charH = h;

                // 物理ボディを作成（サイズ = span の実測値と同じ）
                const body = createCharBody(x, centerY, charW, charH, char);

                // DOM span を作成してコンテナに追加
                const span = createCharSpan(char, fontSize, fontWeight, color);
                charContainer.appendChild(span);

                World.add(world, body);
                charEntries.push({ body, span, charW, charH });
            }

            cursorX += w + letterSpacing;
        });
    }

    // 文字1つの物理ボディを生成する
    function createCharBody(x, y, w, h, label) {
        const body = Bodies.rectangle(x, y, w, h, {
            restitution: CONFIG.restitution,
            friction:    CONFIG.friction,
            frictionAir: CONFIG.frictionAir,
            density:     CONFIG.density,
            label,
        });
        // 元の位置をボディに保存しておく（ダブルクリックリセット用）
        body._originalX = x;
        body._originalY = y;
        return body;
    }

    // 文字1つの表示用 span を生成する
    function createCharSpan(char, fontSize, fontWeight, color) {
        const span = document.createElement('span');
        span.textContent = char;
        span.style.cssText = `
            position: absolute;
            top: 0; left: 0;
            font-size: ${fontSize}px;
            font-weight: ${fontWeight};
            font-family: ${CONFIG.fontFamily};
            color: ${color};
            line-height: 1;
            white-space: pre;
            display: inline-block;
            pointer-events: none;
            user-select: none;
            will-change: transform;
        `;
        return span;
    }


    // ── 物理演出の開始（フェードイン完了後） ────────────────
    setTimeout(() => {
        // 物理ボディ & span を生成
        addTextBodies(h1Text, h1El);
        addTextBodies(pText,  pEl);

        // 元のDOM要素を非表示にして二重表示を防ぐ
        hideOriginalElements();

        startPhysics();
    }, CONFIG.fadeInDelay);

    // 元のHTML要素を非表示にする
    function hideOriginalElements() {
        if (h1El)      h1El.style.opacity      = '0';
        if (pEl)       pEl.style.opacity       = '0';
        if (container) container.style.opacity = '0';
    }


    // ── 物理エンジン本体の起動 ──────────────────────────────
    function startPhysics() {

        // マウス操作を受け付ける透明オーバーレイ
        const overlay = createOverlay();
        document.body.appendChild(overlay);

        // Matter.js のマウス制約をセットアップ
        setupMouseConstraint(overlay);

        // ランナー起動（エンジンのティックを開始）
        const runner = Runner.create();
        Runner.run(runner, engine);

        // 毎フレーム: span をボディに追従させる
        startSyncLoop();

        // ダブルクリックで全文字をリセット
        overlay.addEventListener('dblclick', resetAllBodies);

        // 無重力モードの初期適用
        applyGravityMode(CONFIG.zeroGravity);

        // リサイズ時: 壁を作り直してデバッグcanvasを更新
        setupResizeHandler();
    }

    // マウス操作用の透明オーバーレイ div を生成する
    function createOverlay() {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0; left: 0;
            width: 100%; height: 100%;
            z-index: 99;
            cursor: grab;
        `;
        return overlay;
    }

    // マウス制約（ドラッグ操作）をセットアップする
    function setupMouseConstraint(overlay) {
        const mouse = Mouse.create(overlay);
        const mouseConstraint = MouseConstraint.create(engine, {
            mouse,
            constraint: { stiffness: CONFIG.mouseStiffness, render: { visible: false } },
        });
        World.add(world, mouseConstraint);

        // ドラッグ中はカーソルを grabbing に変える
        Events.on(mouseConstraint, 'startdrag', () => overlay.style.cursor = 'grabbing');
        Events.on(mouseConstraint, 'enddrag',   () => overlay.style.cursor = 'grab');
    }

    // 毎フレーム: span をボディの位置・角度に同期させる
    // 画面外判定は壁に任せるためここでは純粋に追従のみ行う
    function startSyncLoop() {
        function syncDom() {
            charEntries.forEach(({ body, span, charW, charH }) => {
                const { x, y } = body.position;
                const angle = body.angle;

                // span の左上座標 = ボディ中心 - (幅/2, 高さ/2)
                // transformOrigin を span の中心に設定して回転させる
                span.style.transform       = `translate(${x - charW / 2}px, ${y - charH / 2}px) rotate(${angle}rad)`;
                span.style.transformOrigin = `${charW / 2}px ${charH / 2}px`;
            });

            requestAnimationFrame(syncDom);
        }
        syncDom();
    }

    // 全ボディを初期位置・初期姿勢にリセットする
    function resetAllBodies() {
        charEntries.forEach(({ body }) => {
            Body.setPosition(body,        { x: body._originalX, y: body._originalY });
            Body.setVelocity(body,        { x: 0, y: 0 });
            Body.setAngularVelocity(body, 0);
            Body.setAngle(body,           0);
        });
    }


    // ── 無重力モードの適用 ───────────────────────────────────
    // isZeroGravity が true のとき重力を 0 にして各ボディに拡散力を与える
    function applyGravityMode(isZeroGravity) {
        if (isZeroGravity) {
            // 無重力: 重力を 0 にして空気抵抗を少し上げてふわっと漂わせる
            engine.gravity.y = 0;
            charEntries.forEach(({ body }) => {
                Body.set(body, 'frictionAir', CONFIG.frictionAirZero);
            });
            // ボディを中心から外側に向かってそっと拡散させる
            scatterBodies();
        } else {
            // 通常重力: 元の値に戻す
            engine.gravity.y = CONFIG.gravity;
            charEntries.forEach(({ body }) => {
                Body.set(body, 'frictionAir', CONFIG.frictionAir);
            });
        }
    }

    // 全ボディに画面中心から外向きの小さな力を与えて拡散させる
    // 無重力モード開始時に1回だけ呼ぶ
    function scatterBodies() {
        const cx = window.innerWidth  / 2;
        const cy = window.innerHeight / 2;

        charEntries.forEach(({ body }) => {
            const dx = body.position.x - cx;
            const dy = body.position.y - cy;

            // 中心からの距離（0 除算を避けるため最低値を設定）
            const dist = Math.max(Math.hypot(dx, dy), 1);

            // 単位ベクトル方向に CONFIG.scatterForce の大きさで力を加える
            const force = CONFIG.scatterForce;
            Body.applyForce(body, body.position, {
                x: (dx / dist) * force,
                y: (dy / dist) * force,
            });

            // 少しランダムな回転を加えて自然な動きにする
            Body.setAngularVelocity(body, (Math.random() - 0.5) * CONFIG.scatterSpin);
        });
    }


    // ── リサイズ処理 ─────────────────────────────────────────
    function setupResizeHandler() {
        let resizeTimer = null;
        window.addEventListener('resize', () => {
            // 連続リサイズでの過剰な処理を避けるため debounce する
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                // 壁を新しいウィンドウサイズで作り直す
                createWalls();

                // デバッグcanvasのサイズも合わせる
                if (debugRender) {
                    debugRender.canvas.width  = window.innerWidth;
                    debugRender.canvas.height = window.innerHeight;
                    Render.setPixelRatio(debugRender, window.devicePixelRatio);
                }

                // 画面外に出たボディを新しい画面サイズ内にクランプして戻す
                // （毎フレーム干渉する syncLoop ではなくリサイズ確定後の1回だけ実行）
                clampAllBodiesToScreen();
            }, 150);
        });
    }

    // 全ボディの座標を現在の画面サイズに収まるようクランプする
    // リサイズ時のみ呼ぶ（1回だけ位置を修正して速度はゼロにリセット）
    function clampAllBodiesToScreen() {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const margin = 10; // 壁にめり込まないよう少し内側に余裕を持たせる

        charEntries.forEach(({ body, charW, charH }) => {
            const { x, y } = body.position;
            const halfW = charW / 2;
            const halfH = charH / 2;

            const clampedX = Math.min(Math.max(x, halfW + margin), vw - halfW - margin);
            const clampedY = Math.min(Math.max(y, halfH + margin), vh - halfH - margin);

            if (clampedX !== x || clampedY !== y) {
                Body.setPosition(body, { x: clampedX, y: clampedY });
                // 速度はリセット（壁に再衝突して自然に落ち着かせる）
                Body.setVelocity(body, { x: 0, y: 0 });
                Body.setAngularVelocity(body, 0);
            }
        });
    }
};

window.addEventListener("load",function(evt) {
    // 全体のコンテナを取得する
    const container = document.querySelector(".container");

    container.addEventListener("click",function(evt){
        container.style.opacity = '0';

        init();
    })
});
