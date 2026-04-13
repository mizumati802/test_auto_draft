# 🚀 Mercari Bullet Loader：自律巡回型「弾丸装填」ロードマップ

## ⚪ Phase 0：モード判定とコンテキスト継承 (Initial Context & Persistence) 🗝️
- [x] **0.1 初動のH1判定ロジック (Initial H1 Detection)** 判定
    - [x] 初動のドラフト処理時に `mypage#auto_analyze` を隠しウィンドウで開き、`<h1>` からアカウント名をスキャン
    - [x] `[p/blue]` の有無で `vintage` / `standard` モードを自動判別
- [x] **0.2 localStorage への永続化 (Storage Persistence)** 💾
    - [x] 判定結果を `localStorage` (キー: `ve_auto_mode`) に記録
    - [x] `Logic.Workflow.detectMode` を改良し、ストレージに値があれば判定スキップ（高速化）
- [x] **0.3 コンテキストの伝播と巡回 (Context & Hash Propagation)** 🔗
    - [x] 同一セッション内では `localStorage` のモードを維持
    - [x] 一覧画面から下書きへ遷移（クリック）する際、URLにモード情報を付与してコンテキストを継承
- [x] **0.4 自動クリーンアップ (Session Cleanup)** 🧹
    - [x] リストの全アイテム処理完了（または手動停止）時、`ve_auto_mode` を削除して初期化

## 🔴 Phase 1：コンテキスト隔離と自動アクション
- [x] **1. ハッシュ管理 (#Hash Context)** 🏷️
    - [x] 編集画面での `#auto_analyze` 検知による解析自動起動
    - [x] 一覧画面での `#auto_pilot` 検知による巡回モード開始
    - [x] 通常ブラウジングを邪魔しない「ハッシュ・サンドボックス」の確立

- [x] **2. 上書き保存 CRIC (Auto-Save Logic)** 💾
    - [x] 解析完了後、`CRIC`（Click）による「更新する」ボタンの自動実行
    - [x] 保存完了後の遷移（一覧へ戻る）の確実な捕捉

## 🟡 Phase 2：同期制御と自律監視
- [x] **3. 完了フラグ (Completion Flag)** 🚩
    - [x] 登録完了時に `ve_process_completed` フラグを発行
    - [x] 処理済みアイテムを視覚的にマークし、二度踏まない「弾丸装填ライン」

- [x] **4. 10秒ポーリング (10s Pauling)** ⏱️
    - [x] 一覧画面での 10 秒周期ステータス監視の実装
    - [x] 完了フラグの検知をトリガーとした「次の弾丸（Bullet）」の自動射出

## 🔵 Phase 3：自律巡回ループの完成
- [x] **5. 順次 CRIC 処理 (Sequential Loop) 🔄**
    - [x] 各行に物理ボタン [READY] [SHOT] [COMPLETE_NICE] を配置し、状態を可視化
    - [x] 射出前に 2-5 秒のランダムディレイを導入し、安定した順次ループを実現
    - [x] 処理完了後にウィンドウを即座に閉じる（window.close）ことで、高速なコマ送りを確立


## 🟢 Phase 4：Server 5 連携とプロファイル・ブリッジ
- [ ] **6. Local Server 5 統合制御** 🖥️
    - [ ] **開始ロジック**: Server 5 からのシステム起動指示の受取
    - [ ] **終了信号**: 解析完了時の Server 5 への通知実装
    - [ ] **プロファイル・ブリッジ**: 終了信号受信後、`Default` ⇔ `Profile 2` を自動で切り替え、次セッションへ繋ぐ自動化スクリプトの実行

## 🏁 Phase 5：ゴール
- [ ] **7. 完了：深夜の無人弾丸装填ラインの稼働** 🎯
    - [ ] エラーハンドリングの最終調整と、深夜帯の自動稼働テスト

---

### 📘 Phase 0 実装詳細仕様 (Technical Specification)

#### A. `Logic.Workflow.detectMode` の拡張
- **目的**: 毎回 `window.open` を行うことによるリソース消費と遅延を回避。
- **実装**:
    1.  `const cached = localStorage.getItem('ve_auto_mode');` を実行。
    2.  `cached` があれば `Logic.Workflow.state.mode` にセットして `resolve`。
    3.  なければ既存の H1 判定を実行し、完了後に `localStorage.setItem('ve_auto_mode', mode)`。

#### B. コンテキストの伝播 (Context Inheritance)
- **目的**: 次のウィンドウでも `detectMode` をスキップ可能にし、さらに `auto_analyze` を継続させる。
- **実装**:
    - 出品リスト画面（`/mypage/items/drafts`）において、巡回中であればリンク先 URL を書き換える。
    - `href` + `#auto_analyze&mode=vintage` (または standard)。
    - `Logic.Workflow.start` は URL ハッシュ内の `mode=` パラメータを優先的に読み込み、ストレージへの保存も行う。

#### C. 自動クリーンアップ (Storage Cleanup)
- **目的**: 巡回終了後、通常ブラウジング時に誤って自動化モードで起動するのを防ぐ。
- **実装**:
    - リスト画面（`/mypage/items/drafts`）において、巡回対象（未処理の下書き）が 0 件になった場合に `localStorage.removeItem('ve_auto_mode')` を実行。

---

### 🎨 色分けの定義
*   ⚪ **Phase 0**: 起動と状態維持（初動判定と永続化）
*   🔴 **Phase 1**: 基盤構築（URLとボタン制御）
*   🟡 **Phase 2**: 知能実装（状態監視と同期）
*   🔵 **Phase 3**: 自動化（ループの連結）
*   🟢 **Phase 4**: 外部連携（プロファイル跨ぎの完全自動化）
