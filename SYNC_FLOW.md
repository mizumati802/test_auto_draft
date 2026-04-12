# 完全同期フロー & アカウント分岐仕様 (SYNC_FLOW.md)

## 📌 オートメーション・アーキテクチャ
アカウント名による「解析ルート分岐（通常/古着）」と、JS主導の「Masterタイトル校正」を統合した一気通貫フロー。

---

## 📅 実装フェーズ

### ⬛️ Phase 0: アカウント検知 & ルート選定
- **検知対象**: `https://jp.mercari.com/mypage`
- **判定条件**: `h1` 内に **「[p/blue]」** が含まれるか？
    - **有り**: 🅱️-V (古着モード / Vintage Analyze)
    - **無し**: 🅱️-N (通常モード / Standard Analyze)
- **保存**: `Logic.Workflow.state.mode` へ格納。

### 🟩 Phase 1: トリガー & 初期パース (Title Root 🅰️)
- **アクション**: `/sell/draft/` ロード3秒後、Triple-T Parser 実行。
- **成果物**: `{ t1, t2, t3(remarks), calculatedPrice }`

### 🟨 Phase 2: ブリッジ 🤝 & タイトル推論
- **Action 1**: `purchase_id` 先行取得。
- **Action 2**: **Masterタイトル生成 (JS由来)**
    - `ai_logic` のタイトル校正エンドポイントを使用。
    - 入力: `t3(remarks)` + 解析前カテゴリ。
    - 成果物: `FINAL(1) Masterタイトル`

### 🟧 Phase 3: モード別・一気通貫処理 (Async Execution 🅱️)
**Endpoint**: `POST /api/automation/analyze` (ペイロードに `mode` を含む)
**Flow**:
1. **[Vision]**: 画像から属性抽出（モードに応じた精度で実行）。
2. **[Description]**: 🅱️-Vなら `vintage_scanner` による詳細描写。🅱️-Nなら標準生成。
3. **[Binding]**: テンプレート ＋ ハッシュ ＋ ID ＋ **JS生成済みMasterタイトル** をマージ。
4. **[Save]**: `analysis_type: "automation_analyze"` としてDB保存。

### 🟦 Phase 4: 同期レスポンス受信
- 注入用 5点データの最終受け取り。

### 🟪 Phase 5: 5点一括注入 (Final Injection 🚀)
- **FINAL(1) Masterタイトル** (AI校正済)
- **FINAL(2) Master商品説明** (マージ済)
- **FINAL(3) 仕入れ価格** (計算済)
- **FINAL(4) 整合カテゴリ値** (理由+解析)
- **FINAL(5) 備考** (t3内容)

---

## 🛠 データマッピング (Final 5)

| FINAL 項目 | 生成元 | 注入先 (メルカリ) |
| :--- | :--- | :--- |
| **(1) Masterタイトル** | JS主導 (AI校正) | 商品名 |
| **(2) Master商品説明** | Backendマージ | 商品説明 |
| **(3) 仕入れ価格** | Frontend計算 | (DB保存のみ) |
| **(4) カテゴリ** | Backend解析 | カテゴリ/属性 |
| **(5) 備考** | Frontendパース | (DB保存のみ) |

---
*最終更新日: 2026-04-13*
