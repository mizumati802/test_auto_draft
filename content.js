(() => {
  "use strict";

  // =========================================
  // 層 1: System Config (定数層)
  // =========================================
  const CONFIG = {
    API_BASE: 'https://database-app-6ms4.onrender.com',
    STYLE_ID: 've-master-styles',
    PANEL_ID: 've-master-panel',
    LAUNCHER_ID: 've-master-launcher',
    CONDITION_MAP: {
      'noStains': '致命的なダメージではないため「目立った傷や汚れなし」ですが、軽微な使用感（スレ・小キズ・毛玉・やや点シミ・ナイロン革製品のスレ等）や検品の見落としがある場合があります。中古品の特性をご理解ください。',
      'someWear': '使用感や小傷等の中古品特有の状態（綿製品・ニット類の毛玉、ナイロン・革製品のスレ、アクセサリーの小キズ、やや点シミ、検品の見落とし等）がある場合があります。写真をご確認の上ご購入ください。',
      'junk': '一部に剥がれや劣化があり、使用感に加えて不具合のあるジャンク品です。修理等を行ってからのご使用をお勧めします。写真をご確認の上ご購入ください。'
    }
  };

  // =========================================
  // 層 2: Infrastructure (基盤層)
  // =========================================
  const Common = {
    logger: {
      log: (msg, data = {}) => console.log(`%c[VE-Master] ${msg}`, "color: #ff5a5f; font-weight: bold;", data),
      error: (msg, err) => console.error(`%c[VE-Master Error] ${msg}`, "color: #ff0000; font-weight: bold;", err)
    },

    /**
     * 現在のページコンテキストの特定
     */
    getContext: () => {
      const path = window.location.pathname;
      let type = 'unknown';
      if (path.includes('/sell/create') || path.includes('/sell/draft/')) type = 'vintage';
      else if (path.includes('/item/') || path.includes('/products/') || path.includes('/shops/product/')) type = 'ai';
      else if (path.includes('/mypage/drafts')) type = 'listing';

      return {
        type,
        isVintage: type === 'vintage',
        isAi: type === 'ai',
        isListing: type === 'listing',
        url: window.location.href
      };
    },

    /**
     * 要素の出現を待機する MutationObserver ラッパー
     */
    waitForElement: (selector, callback, timeout = 30000) => {
      const el = document.querySelector(selector);
      if (el) return callback(el);

      const observer = new MutationObserver((mutations, obs) => {
        const target = document.querySelector(selector);
        if (target) {
          obs.disconnect();
          callback(target);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), timeout);
    },

    /**
     * 外部 API 通信
     */
    API: {
      fetchConfig: async () => {
        try {
          const res = await fetch(`${CONFIG.API_BASE}/api/external/vintage_extend/config`);
          return await res.json();
        } catch (e) {
          Common.logger.error("Config fetch failed", e);
          return { success: false };
        }
      },
      saveProduct: async (data) => {
        try {
          const res = await fetch(`${CONFIG.API_BASE}/api/external/vintage_extend/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          });
          return await res.json();
        } catch (e) {
          Common.logger.error("Save failed", e);
          return { success: false };
        }
      },
      refineContent: async (endpoint, payload) => {
        try {
          const res = await fetch(`${CONFIG.API_BASE}/api/external/mercari/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          return await res.json();
        } catch (e) {
          Common.logger.error(`AI Refine (${endpoint}) failed`, e);
          return { success: false };
        }
      }
    }
  };

  const Storage = {
    _rawGet: (keys) => new Promise(resolve => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(keys, resolve);
      } else {
        Common.logger.error("Chrome Storage API not available");
        resolve({});
      }
    }),
    _rawSet: (data) => new Promise(resolve => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set(data, resolve);
      } else {
        Common.logger.error("Chrome Storage API not available");
        resolve();
      }
    }),

    // --- 高レベル・ストレージ・メソッド ---

    /** AI修正パネルの開閉状態 */
    getAiPanelState: async () => (await Storage._rawGet(['isAiPanelOpen'])).isAiPanelOpen,
    setAiPanelState: (isOpen) => Storage._rawSet({ isAiPanelOpen: isOpen }),

    /** AI修正パネルの選択中タブ (normal / vintage) */
    getAiActiveTab: async () => (await Storage._rawGet(['aiActiveTab'])).aiActiveTab || 'normal',
    setAiActiveTab: (tab) => Storage._rawSet({ aiActiveTab: tab }),

    /** 出品補助パネルの選択中テンプレート */
    getVeActiveTemplate: async () => (await Storage._rawGet(['veActiveTemplate'])).veActiveTemplate || '小物',
    setVeActiveTemplate: (tpl) => Storage._rawSet({ veActiveTemplate: tpl }),

    /** 出品補助パネル（ランチャー）の開閉状態 */
    getVintagePanelState: async () => (await Storage._rawGet(['isPanelOpen'])).isPanelOpen,
    setVintagePanelState: (isOpen) => Storage._rawSet({ isPanelOpen: isOpen }),

    /** 出品履歴の管理（最新3件） */
    getHistory: async () => (await Storage._rawGet(['ve_history'])).ve_history || [],
    saveHistory: async (item) => {
      const hist = await Storage.getHistory();
      hist.unshift(item);
      await Storage._rawSet({ ve_history: hist.slice(0, 3) });
    },

    /** AI修正データの予約・読込 */
    getPendingAiData: async () => (await Storage._rawGet(['pending_ai_data'])).pending_ai_data,
    setPendingAiData: (data) => Storage._rawSet({ pending_ai_data: { ...data, timestamp: Date.now() } }),
    markAiDataUsed: async () => {
      const data = await Storage.getPendingAiData();
      if (data) await Storage._rawSet({ pending_ai_data: { ...data, isNew: false } });
    }
  };

  const StateManager = {
    state: {
      nextId: '...',
      templates: {},
      hashtags_map: {},
      currentHashtags: ''
    },
    /**
     * 起動時に全設定をロードしてメモリにキャッシュ
     */
    init: async () => {
      Common.logger.log("Loading State...");
      const res = await Common.API.fetchConfig();
      if (res && res.success) {
        StateManager.state.nextId = res.next_id;
        StateManager.state.templates = res.templates.reduce((acc, t) => {
          acc[t.title] = t.txt;
          return acc;
        }, {});
        
        if (res.hashtags) {
          StateManager.state.hashtags_map = res.hashtags.reduce((acc, h) => {
            acc[h.category] = h.hashtag_text;
            return acc;
          }, {});
          
          // 初期ハッシュタグの設定 (all優先)
          const defaultCat = StateManager.state.hashtags_map['all'] ? 'all' : (res.hashtags[0]?.category || '');
          StateManager.state.currentHashtags = StateManager.state.hashtags_map[defaultCat] || '';
        }
        Common.logger.log("State Loaded Successfully");
      }
    }
  };

  // =========================================
  // 層 3: Business Logic / Domain (判断ロジック層)
  // =========================================
  const Logic = {
    /**
     * Triple-T Parser: 「t1(価格) t2(割引) t3(メモ)」の分解
     */
    TitleParser: {
      parse: (rawTitle) => {
        if (!rawTitle) return null;
        
        // 全角英数字を半角に正規化
        const normalized = rawTitle.replace(/[！-～]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
        const parts = normalized.trim().split(/\s+/);
        if (parts.length === 0) return null;

        const result = { t1: null, t2: 0, t3: "", calculatedPrice: null };

        // t1: 最初の要素（数値）
        const first = parts[0].replace(/[^0-9]/g, '');
        if (first) result.t1 = parseInt(first, 10);

        // t2: 2番目の要素が「数値のみ」かつ「3文字以内」かチェック
        if (parts.length >= 2) {
          const secondRaw = parts[1];
          const isNumericOnly = /^\d+$/.test(secondRaw);
          if (isNumericOnly && secondRaw.length <= 3) {
            result.t2 = parseInt(secondRaw, 10);
            // t2が確定したので、t3は3番目以降
            result.t3 = parts.slice(2).join(" ");
          } else {
            // t2が条件に合わないので、t2以降すべてがt3
            result.t3 = parts.slice(1).join(" ");
          }
        }

        // 価格計算: t1 から t2% を差し引いた値を「仕入れ価格」として算出
        if (result.t1 !== null) {
          const discountAmount = Math.floor(result.t1 * (result.t2 / 100));
          result.calculatedPrice = result.t1 - discountAmount;
        }

        console.log("--- [Triple-T Parse Result] ---", {
          original: rawTitle,
          normalized: normalized,
          parsed: result
        });
        return result;
      }
    },

    /**
     * オートメーション・ワークフロー制御
     */
    Workflow: {
      state: {
        mode: "standard", // "vintage" or "standard"
        isInherited: false, // 継承フラグ
        rootA: null, // TitleRoot結果
        rootB: null, // ImageRoot結果
        purchaseId: null
      },

      /** 
       * Phase 0: モード判定（受動的）
       * ドラフト画面で使用。一覧画面が決めた値を解決するだけ。
       */
      detectMode: () => {
        // 1. URLハッシュからの継承チェック
        const hashMatch = window.location.hash.match(/mode=(vintage|standard)/);
        if (hashMatch) {
          const mode = hashMatch[1];
          console.log(`[Workflow] Mode inherited from URL hash: ${mode.toUpperCase()}`);
          Logic.Workflow.state.mode = mode;
          Logic.Workflow.state.isInherited = true;
          return mode;
        }

        // 2. localStorageからの継承チェック
        const cachedMode = localStorage.getItem('ve_auto_mode');
        if (cachedMode) {
          console.log(`[Workflow] Mode restored from storage: ${cachedMode.toUpperCase()}`);
          Logic.Workflow.state.mode = cachedMode;
          Logic.Workflow.state.isInherited = true;
          return cachedMode;
        }

        console.log("[Workflow] No mode context found. Using default: STANDARD");
        Logic.Workflow.state.mode = "standard";
        return "standard";
      },

      /**
       * Phase 0: モード取得（内部検索）
       * 5秒待機後、ページ内の p 要素に 'p/blue' が含まれているかを確認してモードを確定させる。
       */
      fetchModeActive: () => {
        return new Promise((resolve) => {
          console.log("[Workflow] Phase 0: Waiting 5 seconds before detection...");
          
          setTimeout(() => {
            const paragraphs = document.querySelectorAll('p');
            let hasBlueMark = false;

            paragraphs.forEach((p) => {
              if (p.textContent.includes("p/blue")) {
                hasBlueMark = true;
              }
            });

            const mode = hasBlueMark ? "vintage" : "standard";
            const modeLabel = mode === "vintage" ? "🍷 古着モード" : "📦 通常モード";
            const bgColor = mode === "vintage" ? "#800080" : "#006400";
            
            console.log(`[Workflow] Internal Detection Success: ${mode.toUpperCase()}`);
            localStorage.setItem('ve_auto_mode', mode);
            Logic.Workflow.state.mode = mode;

            // 判定結果をシンプルに表示
            const overlay = document.createElement('div');
            overlay.style.cssText = `
              position: fixed;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
              padding: 30px 60px;
              background: ${bgColor};
              color: white;
              font-size: 40px;
              font-weight: bold;
              border-radius: 12px;
              z-index: 999999;
              box-shadow: 0 4px 20px rgba(0,0,0,0.5);
              pointer-events: none;
              text-align: center;
              border: 2px solid white;
            `;
            overlay.textContent = modeLabel;
            document.body.appendChild(overlay);

            // 2秒後に消去して次へ
            setTimeout(() => {
              overlay.remove();
              resolve(mode);
            }, 2000);
          }, 5000);
        });
      },

      /** ステータス表示の更新 */
      updateStatus: (html, isError = false) => {
        const popup = document.querySelector('.ve-draft-popup');
        if (popup) {
          popup.innerHTML += `<br>${html}`;
          if (isError) popup.style.borderColor = '#ff5a5f';
        }
      },

      /** ワークフロー開始 */
      start: async () => {
        console.log("[Workflow] Starting Automation...");
        
        // 1. モード判定が完了するまで待機
        let waitCount = 0;
        while (Logic.Workflow.state.mode === "standard" && !localStorage.getItem('ve_auto_mode') && waitCount < 20) {
          console.log("[Workflow] Waiting for mode detection to complete...");
          await new Promise(r => setTimeout(r, 500));
          waitCount++;
        }

        // 2. 要素が完全に準備されるまで 10秒間待機
        console.log("[Workflow] Waiting 10 seconds for elements to stabilize...");
        await new Promise(r => setTimeout(r, 10000));

        // --- Phase 1 & Root A ---
        const resultA = Logic.DraftChecker.checkDescription();
        
        if (!resultA) {
          // 要素が見つからない場合のリロード監視（最大3回）
          const reloadCount = parseInt(localStorage.getItem('ve_start_reload_count') || '0', 10);
          const nextCount = reloadCount + 1;
          
          if (nextCount < 3) {
            console.warn(`[Workflow] Elements not found. Reloading... (${nextCount}/3)`);
            localStorage.setItem('ve_start_reload_count', nextCount.toString());
            window.location.reload();
          } else {
            console.error("[Workflow] Max reloads (3) reached. Closing tab.");
            localStorage.setItem('ve_start_reload_count', '0'); // リセット
            window.close();
          }
          return;
        }

        // 正常に解析ルート（パーサー判定）に入ったため、カウントをリセット
        localStorage.setItem('ve_start_reload_count', '0');
        console.log("[Workflow] Parser started successfully. Reload counter reset.");
        
        Logic.Workflow.state.rootA = resultA;
        UI.showDraftResult(resultA);

        // 条件チェック: 3行未満 かつ 画像あり の場合のみ解析へ進む
        if (resultA.count < 3 && resultA.hasImage) {
          Logic.Workflow.updateStatus("<span style='color:#4285f4'>⏳ 5秒後に解析を開始します...</span>");
          setTimeout(() => Logic.Workflow.startBeta(), 5000);
        } else {
          // オートメーション中のスキップ処理 (3行以上 または 画像なし)
          if (window.location.hash.includes('auto_analyze')) {
            const reason = resultA.count >= 3 ? "3行以上の記述があるため" : "画像がないため";
            Logic.Workflow.updateStatus(`<span style='color:#ffc107'>⏩ ${reason}スキップします...</span>`);
            
            // 完了フラグとID記録（次へ進むため）
            localStorage.setItem('ve_process_completed', 'true');
            const match = window.location.pathname.match(/\/sell\/draft\/([^\/]+)/);
            if (match) {
              localStorage.setItem('ve_last_processed_id', match[1]);
            }

            // 完了通知後にウィンドウを閉じる
            setTimeout(() => {
              window.close();
            }, 1500);
          } else {
            Logic.Workflow.updateStatus("<span style='color:#ffc107'>⚠️ 自動化の条件を満たしていません。</span>");
            setTimeout(() => {
              const p = document.querySelector('.ve-draft-popup');
              if (p) p.remove();
            }, 3000);
          }
        }
      },

      /** Root B: 画像解析・ID発行の開始 */
      startBeta: async () => {
        console.log("[Workflow] 🚀 Starting Root B (R2-Buffered Pipeline)...");
        Logic.Workflow.updateStatus("<span style='color:#4285f4'>📡 Root B: 準備中...</span>");

        try {
          // 1. purchase_id の先行取得
          const idResp = await fetch("https://database-app-6ms4.onrender.com/api/vintage/master_data");
          const idData = await idResp.json();
          if (!idData.success) throw new Error("ID発行失敗");
          Logic.Workflow.state.purchaseId = idData.purchase_id;
          Logic.Workflow.updateStatus(`<span style='color:#34a853'>✅ ID発行成功: ${idData.purchase_id}</span>`);

          // 2. 画像の取得と R2 アップロード
          Logic.Workflow.updateStatus("<span style='color:#4285f4'>📸 サムネイルを R2 へ転送中...</span>");
          const imgSrc = Logic.DraftChecker.hasThumbnail();
          if (!imgSrc) throw new Error("画像が見つかりません");
          
          const imgBlob = await fetch(imgSrc).then(r => r.blob());
          const formData = new FormData();
          formData.append('file', imgBlob, `auto_${Date.now()}.jpg`);

          const uploadResp = await fetch('https://database-app-6ms4.onrender.com/api/upload/google_lens', {
            method: 'POST',
            body: formData
          });
          const uploadData = await uploadResp.json();
          if (!uploadData.success || !uploadData.url) throw new Error("R2アップロード失敗");
          
          const r2Url = uploadData.url;
          Logic.Workflow.updateStatus("<span style='color:#34a853'>✅ R2バッファリング完了</span>");

          /* 
          // 3. AI タイトル校正 (JS主導) - 順序不備および重複回避のためスキップ
          Logic.Workflow.updateStatus("<span style='color:#4285f4'>✍️ Masterタイトル推論中...</span>");
          const titleResp = await fetch("https://database-app-6ms4.onrender.com/api/ai/mercari_title_refine", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              text: Logic.Workflow.state.rootA.remarks, // t3 を渡す
              mode: Logic.Workflow.state.mode 
            })
          });
          const titleData = await titleResp.json();
          const masterTitle = titleData.success ? titleData.refined_title : Logic.Workflow.state.rootA.remarks;
          Logic.Workflow.updateStatus(`<span style='color:#34a853'>✅ Masterタイトル確定: ${masterTitle.substring(0, 15)}...</span>`);
          */

          // 4. 一気通貫解析 ＆ 保存リクエスト (R2 URLを使用)
          Logic.Workflow.updateStatus("<span style='color:#4285f4'>🧠 Vision AI & テンプレート結合中...</span>");
          const analyzeResp = await fetch("https://database-app-6ms4.onrender.com/api/external/automation/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              image_url: r2Url,
              remarks: Logic.Workflow.state.rootA.remarks,
              purchase_id: Logic.Workflow.state.purchaseId,
              purchase_price: Logic.Workflow.state.rootA.parsedTitle.calculatedPrice,
              title_master: Logic.Workflow.state.rootA.remarks, // t3 をそのまま渡す
              mode: Logic.Workflow.state.mode,
              category1: "出品理由（仮）"
            })
          });
          const finalResult = await analyzeResp.json();
          if (!finalResult.success) throw new Error(finalResult.message || "解析に失敗しました");

          Logic.Workflow.state.rootB = finalResult.final_data;
          Logic.Workflow.updateStatus("<span style='color:#34a853'>✨ オートメーション解析完了！</span>");

          // 5. 最終注入 (Final Injection)
          setTimeout(() => {
            Logic.Workflow.injectFinalData(finalResult.final_data);
          }, 1000);

        } catch (err) {
          console.error("[Workflow] Root B Error:", err);
          Logic.Workflow.updateStatus(`<span style='color:#ff5a5f'>❌ エラー: ${err.message}</span>`, true);
        }
      },

      /** 最終データの流し込み (DOM操作) - EasyRegister Refactor版準拠 */
      injectFinalData: (data) => {
        console.log("[Workflow] Starting Secure Injection...");

        const syncToMercari = (selectors, value) => {
          if (!value) return false;
          const selectorArray = Array.isArray(selectors) ? selectors : [selectors];
          let input = null;
          for (const sel of selectorArray) {
            input = document.querySelector(sel);
            if (input) break;
          }
          if (!input) return false;
          
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        };

        // 1. Title (商品名)
        const titleInjected = syncToMercari([
          'input[name="name"]', 
          '.merInputNode[name="name"]', 
          '[data-testid="name"] input'
        ], data.title);
        if (titleInjected) console.log("✅ Title Injected");

        // 2. Description (商品説明)
        const descInjected = syncToMercari([
          'textarea[name="description"]', 
          'textarea.merInputNode', 
          '[data-testid="description"] textarea'
        ], data.description);
        if (descInjected) console.log("✅ Description Injected");

        if (titleInjected && descInjected) {
          Logic.Workflow.updateStatus("<span style='color:#34a853'>🚀 すべての項目を確実に流し込みました。</span>");
          
          // オートメーションハッシュがある場合のみ自動保存実行
          if (window.location.hash.includes('auto_analyze')) {
            Logic.Workflow.updateStatus("<span style='color:#4285f4'>💾 2秒後に「上書き保存」を実行します...</span>");
            setTimeout(() => {
              const saveBtn = Array.from(document.querySelectorAll('button[type="button"]'))
                .find(btn => btn.innerText.includes('上書き保存する'));
              
              if (saveBtn) {
                console.log("[Workflow] Auto-clicking Save Button...");
                
                // 完了フラグと重複排除用IDの保存
                localStorage.setItem('ve_process_completed', 'true');
                const match = window.location.pathname.match(/\/sell\/draft\/([^\/]+)/);
                if (match) {
                  localStorage.setItem('ve_last_processed_id', match[1]);
                }

                saveBtn.click();
                
                // 保存実行後、1.5秒待機してタブを閉じる（親ウィンドウが巡回を継続するため）
                setTimeout(() => {
                  window.close();
                }, 1500);
              } else {
                console.warn("[Workflow] Save Button not found.");
                Logic.Workflow.updateStatus("<span style='color:#ff5a5f'>❌ 保存ボタンが見つかりません</span>", true);
              }
            }, 2000);
          }
        } else {
          Logic.Workflow.updateStatus("<span style='color:#ffc107'>⚠️ 一部の項目が見つからず、流し込めませんでした。</span>");
        }
        
        // ポップアップ消去（保存された場合は画面遷移するので自然に消える）
        setTimeout(() => {
          const p = document.querySelector('.ve-draft-popup');
          if (p) p.remove();
        }, 3000);
      }
    },

    /**
     * 下書きページのチェックロジック
     */
    DraftChecker: {
      /** サムネイル画像（1枚目）の存在を確認 */
      hasThumbnail: () => {
        const thumb = document.querySelector('[data-testid="image-list-item-0"] img');
        return thumb && thumb.src ? thumb.src : null;
      },

      /** タイトル入力欄の取得 */
      getTitleInput: () => {
        return document.querySelector('input[name="name"]') || 
               document.querySelector('[data-testid="name"] input') ||
               document.querySelector('input.merInputNode[placeholder*="商品名"]');
      },

      checkDescription: () => {
        const textarea = document.querySelector('textarea[name="description"]') || 
                         document.querySelector('textarea.merInputNode') ||
                         document.querySelector('[data-testid="description"] textarea');
        const titleInput = Logic.DraftChecker.getTitleInput();
        
        if (!textarea || !titleInput) return null;
        
        const text = textarea.value.trim();
        const lines = text.split(/\r\n|\r|\n/).filter(line => line.length > 0);
        const count = lines.length;
        const thumbSrc = Logic.DraftChecker.hasThumbnail();
        const titleParsed = Logic.TitleParser.parse(titleInput.value.trim());

        // モード表示の構築
        const mode = Logic.Workflow.state.mode;
        const isInherited = Logic.Workflow.state.isInherited;
        const modeEmoji = mode === "vintage" ? "🍷" : "📦";
        const modeName = mode === "vintage" ? "古着モード" : "通常モード";
        const inheritMsg = isInherited ? `\n✅ 継承完了: 継承_モード${mode === "vintage" ? "古着" : "通常"}` : "";
        
        let statusText = `【${modeEmoji} ${modeName}】${inheritMsg}\n`;
        statusText += count <= 3 ? `✨ 商品説明は3行以内です (${count}行)` : `⚠️ 商品説明が3行を超えています (${count}行)`;
        statusText += thumbSrc ? "\n📸 画像あり" : "\n🚫 画像なし";
        
        if (titleParsed) {
          statusText += `\n🏷️ t1:${titleParsed.t1 || '?'}, t2:${titleParsed.t2 || '0'}, t3:${titleParsed.t3 || '-'}`;
          if (titleParsed.calculatedPrice !== null) {
            statusText += `\n💰 仕入れ価格: ¥${titleParsed.calculatedPrice.toLocaleString()}`;
          }
        } else {
          statusText += "\n🚫 タイトル未解析";
        }

        return {
          isShort: count <= 3,
          hasImage: !!thumbSrc,
          imageSrc: thumbSrc,
          titleValue: titleInput.value.trim(),
          parsedTitle: titleParsed, // パース済みデータ一式
          remarks: titleParsed ? titleParsed.t3 : "", // 画像解析へのブリッジ用
          count: count,
          text: statusText
        };
      }
    },

    /**
     * テンプレートのプレースホルダー置換
     */
    TemplateEngine: {
      render: (template, replacements) => {
        let rendered = template || "{description}\n\n状態:{full_condition}\n\n{hashtags}";
        for (const [key, val] of Object.entries(replacements)) {
          rendered = rendered.split(key).join(val || "");
        }
        return rendered.trim();
      }
    },

    /**
     * タイトルのキーワードに基づいたハッシュタグカテゴリの選別
     */
    HashtagSelector: {
      selectByTitle: (title) => {
        const bracketMatch = title.match(/【(.*?)】/);
        if (!bracketMatch) return '生活小物'; // デフォルト

        const inner = bracketMatch[1].toLowerCase();
        // 優先順位 1: 平成グランジ系
        if (['archive', '00', 'y2k', '平成'].some(k => inner.includes(k))) return '平成グランジ系';
        // 優先順位 2: ヴィンテージ / 年代物 (all)
        if (['vintage', '90', '80', '70', '60', '50'].some(k => inner.includes(k))) return 'all';

        return '生活小物';
      }
    },

    /**
     * 割引価格の計算
     */
    PriceCalc: {
      calculate: (price, discount) => {
        const p = parseInt(price, 10) || 0;
        const d = parseInt(discount, 10) || 0;
        return Math.floor(p * (1 - d / 100));
      }
    },

    /**
     * 商品詳細ページからのスクレイピング判断
     */
    Scraper: {
      extractPageData: () => {
        const title = document.querySelector('h1[class*="heading__"]')?.innerText.trim() || "";
        const description = (
          document.querySelector('pre[data-testid="description"]') || 
          document.querySelector('[data-testid="description"]') ||
          document.querySelector('pre.merText')
        )?.innerText.trim() || "";
        
        const container = document.querySelector('[data-testid="item-size-and-brand-container"]');
        const brand = container?.querySelector('.merText')?.innerText.trim() || "";

        return { title, description, brand };
      }
    }
  };

  // =========================================
  // 層 4: Visual Styles (スタイル層)
  // =========================================
  const StyleModule = {
    inject: (ctx) => {
      if (document.getElementById(CONFIG.STYLE_ID)) return;
      const styleEl = document.createElement('style');
      styleEl.id = CONFIG.STYLE_ID;
      styleEl.textContent = StyleModule.getStyles(ctx);
      document.head.appendChild(styleEl);
    },
    remove: () => {
      const el = document.getElementById(CONFIG.STYLE_ID);
      if (el) el.remove();
    },
    getStyles: (ctx) => `
      /* Master Base Design */
      #${CONFIG.LAUNCHER_ID} {
        position: fixed; top: 20px; left: 20px; z-index: 999999;
        width: 40px; height: 40px; background: #ff5a5f; color: white;
        border-radius: 50%; display: flex; align-items: center; justify-content: center;
        font-weight: bold; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        transition: transform 0.2s; font-size: 20px;
      }
      #${CONFIG.LAUNCHER_ID}:hover { transform: scale(1.1); }

      #${CONFIG.PANEL_ID} {
        position: fixed; top: 20px; left: 20px; z-index: 999999;
        width: 280px; max-height: 90vh; background: #1a1a1a; color: #efefef;
        border-radius: 12px; display: none; flex-direction: column;
        box-shadow: 0 8px 24px rgba(0,0,0,0.5); border: 1px solid #333; overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }

      .ve-header {
        background: #222; padding: 12px 15px; display: flex; justify-content: space-between;
        align-items: center; border-bottom: 1px solid #333; font-weight: bold; color: #ff5a5f;
      }
      .ve-close { cursor: pointer; font-size: 20px; background: none; border: none; color: #888; }
      .ve-close:hover { color: white; }

      .ve-body { padding: 10px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
      
      .ve-field { display: flex; flex-direction: column; gap: 3px; }
      .ve-label { font-size: 11px; color: #555; font-weight: 800; text-transform: uppercase; }
      .ve-input, .ve-select, .ve-textarea {
        width: 100%; background: #1a1a1a; border: 1px solid #333; color: #fff;
        padding: 6px 8px; border-radius: 4px; font-size: 15px; outline: none;
        box-sizing: border-box;
      }
      .ve-input:focus, .ve-textarea:focus { border-color: #666666; }
      .ve-textarea-small { height: 45px; resize: none; }
      
      .ve-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      
      .ve-master-btn {
        background: #444; color: white; border: none; padding: 10px;
        border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 13px;
        transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 5px;
      }
      .ve-master-btn:hover { filter: brightness(1.2); }
      .ve-master-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      
      .btn-primary { background: #ff5a5f; }
      .btn-success { background: #28a745; }
      .btn-warning { background: #ffc107; color: #000; font-weight: 800; }
      .btn-ai { background: linear-gradient(135deg, #6a11cb, #2575fc); }
      .btn-mini { padding: 4px 8px; font-size: 11px; }

      .ve-id-display { font-size: 32px; font-weight: bold; text-align: center; color: #ff5a5f; letter-spacing: 2px; }
      .ve-status { font-size: 12px; text-align: center; height: 18px; color: #ffc107; }
      
      .ve-hist-row { display: flex; gap: 5px; align-items: center; background: #111; padding: 5px 10px; border-bottom: 1px solid #333; }
      .ve-hist-btn { width: 24px; height: 20px; font-size: 10px; background: #333; color: #888; border: none; border-radius: 3px; cursor: pointer; }
      .ve-hist-btn.active { background: #ff5a5f; color: white; }

      .ve-select-dark {
        background: #000 !important; border-color: #111 !important; color: #444 !important;
        font-size: 12px !important; padding: 4px 8px !important; transition: all 0.2s ease;
      }
      .ve-select-dark:hover, .ve-select-dark:focus { border-color: #333 !important; color: #888 !important; }

      .ai-panel-section { background: #222; padding: 10px; border-radius: 8px; border: 1px solid #333; margin-top: 15px; display: none; flex-direction: column; }
      .ai-output-area { background: #000; font-size: 14px; margin-top: 8px; }

      .ve-tabs { display: flex; gap: 2px; margin-bottom: 10px; background: #333; padding: 2px; border-radius: 6px; }
      .ve-tab {
        flex: 1; padding: 6px; text-align: center; font-size: 11px; font-weight: bold;
        cursor: pointer; border-radius: 4px; color: #888; transition: all 0.2s;
      }
      .ve-tab.active { background: #ff5a5f; color: white; }
      .ve-tab-content { display: none; }
      .ve-tab-content.active { display: block; }

      #ai-extender-launcher {
        display: inline-flex; align-items: center; gap: 5px;
        background: #333; color: #fff; padding: 5px 12px; border-radius: 20px;
        font-size: 12px; font-weight: bold; cursor: pointer; margin-top: 10px;
        border: 1px solid #444; transition: all 0.2s;
      }
      #ai-extender-launcher:hover { background: #444; border-color: #ff5a5f; }

      /* Draft Check Popup */
      .ve-draft-popup {
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background: rgba(20, 20, 20, 0.95); color: white; padding: 30px 60px;
        border-radius: 16px; font-size: 20px; font-weight: bold; z-index: 1000001;
        box-shadow: 0 15px 40px rgba(0,0,0,0.6); border: 3px solid #ff5a5f;
        text-align: center; pointer-events: none; min-width: 400px; line-height: 1.6;
      }
      @keyframes veFadeInOut {
        0% { opacity: 0; transform: translate(-50%, -40%); }
        15% { opacity: 1; transform: translate(-50%, -50%); }
        85% { opacity: 1; transform: translate(-50%, -50%); }
        100% { opacity: 0; transform: translate(-50%, -60%); }
      }
    `
  };

  // =========================================
  // 層 5: Automated Actions / Engine (実行エンジン層)
  // =========================================
  const Automator = {
    /**
     * メルカリ純正入力欄への物理同期 (複数セレクタ対応)
     */
    syncToMercari: (selectors, value) => {
      const selectorArray = Array.isArray(selectors) ? selectors : [selectors];
      let input = null;
      for (const sel of selectorArray) {
        input = document.querySelector(sel);
        if (input) break;
      }
      if (!input) return;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },

    /**
     * AI 修正データのストレージ予約
     */
    queueAiData: async (title, description) => {
      await Storage.setPendingAiData({ title, description, isNew: true });
      Common.logger.log("AI Data Queued for Transfer");
    },

    /**
     * ストレージから AI データを読み取り、パネルにセット
     */
    loadAiData: async (callbacks) => {
      const data = await Storage.getPendingAiData();
      if (data) {
        if (callbacks.onSet) callbacks.onSet(data);
        return data;
      }
      return null;
    }
  };

  // =========================================
  // 層 6: UI Components (部品層)
  // =========================================
  const UI = {
    /**
     * 下書きチェック結果のポップアップ表示
     */
    showDraftResult: (result) => {
      if (!result) return;
      const popup = document.createElement('div');
      popup.className = 've-draft-popup';
      if (!result.isShort) popup.style.borderColor = '#ffc107';
      popup.innerHTML = result.text.replace(/\n/g, '<br>');
      document.body.appendChild(popup);
    },

    /**
     * マスター・ボタンファクトリ
     */
    btn: (txt, cls, click, opts = {}) => {
      const b = document.createElement('button');
      b.innerHTML = txt;
      b.className = `ve-master-btn ${cls}`;
      if (opts.id) b.id = opts.id;
      if (opts.title) b.title = opts.title;
      if (click) b.onclick = (e) => { e.preventDefault(); click(e); };
      return b;
    },

    /**
     * 出品補助パネルの構築
     */
    createVintagePanel: () => {
      if (document.getElementById(CONFIG.PANEL_ID)) return;

      const panel = document.createElement('div');
      panel.id = CONFIG.PANEL_ID;
      panel.innerHTML = `
        <div class="ve-header"><span>EASY REGISTER MASTER</span><button class="ve-close">×</button></div>
        <div class="ve-hist-row">
          <span class="ve-label" style="margin:0;">HIST</span>
          <button class="ve-hist-btn" data-idx="0" disabled>1</button>
          <button class="ve-hist-btn" data-idx="1" disabled>2</button>
          <button class="ve-hist-btn" data-idx="2" disabled>3</button>
          <div style="flex:1;"></div>
          <button id="ve-fetch-ai-btn" class="ve-master-btn btn-ai btn-mini">✨ AI吸い上げ</button>
        </div>
        <div class="ve-body">
          <div class="ve-field" style="border-bottom:1px solid #333; padding-bottom:10px;">
            <span class="ve-label" id="ve-id-label">PRODUCT ID</span>
            <div id="ve-next-id" class="ve-id-display">${StateManager.state.nextId}</div>
          </div>
          <div class="ve-field">
            <label class="ve-label">ITEM NAME <span id="ve-char-cnt" style="float:right;">0/40</span></label>
            <div style="display:flex; gap:5px;">
              <input type="text" id="ve-item-name" class="ve-input" style="flex:1;" placeholder="タイトルを入力...">
              <button id="ve-copy-title-btn" class="ve-master-btn btn-mini">コピー</button>
            </div>
          </div>
          <div class="ve-field">
            <label class="ve-label">FREE WORD / DESCRIPTION</label>
            <textarea id="ve-free-word" class="ve-textarea ve-textarea-small" placeholder="サイズ、詳細な など..."></textarea>
          </div>
          <div class="ve-row">
            <div class="ve-field"><label class="ve-label">PRICE</label><input type="number" id="ve-price" class="ve-input"></div>
            <div class="ve-field">
              <label class="ve-label">DISC(%)</label>
              <select id="ve-discount" class="ve-select">
                <option value="0">0</option><option value="20">20</option><option value="30">30</option>
                <option value="50">50</option><option value="70">70</option>
              </select>
            </div>
          </div>
          <div id="ve-calc-price" style="text-align:right; color:#28a745; font-weight:bold;">¥0</div>
          <div class="ve-row">
            <div class="ve-field"><label class="ve-label">TEMPLATE</label><select id="ve-template" class="ve-select"></select></div>
            <div class="ve-field">
              <label class="ve-label">CONDITION</label>
              <select id="ve-condition" class="ve-select">
                <option value="noStains">目立った傷なし</option>
                <option value="someWear">やや傷汚れ</option>
                <option value="junk">ジャンク</option>
              </select>
            </div>
          </div>
          <div class="ve-field"><label class="ve-label">HASHTAGS</label><select id="ve-hashtag-rules" class="ve-select-dark"></select></div>
          <div class="ve-field">
            <label class="ve-label">PREVIEW (WORD) <button id="ve-proofread-btn" class="ve-master-btn btn-ai btn-mini" style="display:inline-block; margin-left:10px;">✨ AI校正</button></label>
            <textarea id="ve-word-output" class="ve-textarea" style="height:120px;"></textarea>
            <button id="ve-copy-word-btn" class="ve-master-btn btn-success" style="margin-top:5px;">完成文をコピー</button>
          </div>
          <div class="ve-field"><label class="ve-label">MEMO (DB ONLY)</label><textarea id="ve-memo" class="ve-textarea ve-textarea-small" style="height:40px;"></textarea></div>
          <button id="ve-save-btn" class="ve-master-btn btn-primary">DBへ保存 & 出品反映</button>
          <div id="ve-status" class="ve-status"></div>
        </div>
      `;
      document.body.appendChild(panel);
      UI.loadSelectOptions(panel); // 1. 先に選択肢をロードし「小物」をセット
      UI.setupVintageEvents(panel); // 2. その後イベント設定と初期 update() を実行
      UI.setupCopyActions(panel);
      UI.updateHistoryUI(panel);
    },

    /**
     * コピーアクションと ID リセットロジック
     */
    setupCopyActions: (panel) => {
      const setup = (btnId, inputId) => {
        const btn = panel.querySelector('#' + btnId);
        btn.onclick = () => {
          const val = panel.querySelector('#' + inputId).value;
          navigator.clipboard.writeText(val).then(() => {
            const old = btn.innerText; btn.innerText = 'OK!';
            // 完成文コピー時、リストア中なら最新IDに戻す
            if (btnId === 've-copy-word-btn') {
              const idEl = panel.querySelector('#ve-next-id');
              const labelEl = panel.querySelector('#ve-id-label');
              if (idEl.hasAttribute('data-restored')) {
                idEl.innerText = StateManager.state.nextId;
                idEl.style.color = '';
                idEl.removeAttribute('data-restored');
                labelEl.innerText = 'PRODUCT ID';
                labelEl.style.color = '';
              }
            }
            setTimeout(() => { btn.innerText = old; }, 1000);
          });
        };
      };
      setup('ve-copy-title-btn', 've-item-name');
      setup('ve-copy-word-btn', 've-word-output');
    },

    /**
     * 詳細画面での AI 修正パネル構築
     */
    createAiPanel: () => {
      if (document.getElementById('ai-extender-panel')) return;
      Common.waitForElement('h1[class*="heading__"]', (h1) => {
        // ランチャーの生成
        const launcher = document.createElement('div');
        launcher.id = 'ai-extender-launcher';
        launcher.innerHTML = '✨ AI修正パネルを開く';
        h1.parentNode.insertBefore(launcher, h1.nextSibling);

        const panel = document.createElement('div');
        panel.id = 'ai-extender-panel';
        panel.className = 'ai-panel-section';
        panel.innerHTML = `
          <div class="ve-header" style="margin: -10px -10px 10px -10px;">
            <span>✨ AI MASTER CLEANING</span>
            <button class="ve-close" id="ai-panel-close">×</button>
          </div>
          
          <div class="ve-tabs">
            <div class="ve-tab active" data-tab="normal">通常モード</div>
            <div class="ve-tab" data-tab="vintage">古着モード</div>
          </div>

          <div id="ve-tab-content-vintage" class="ve-tab-content" style="margin-bottom: 40px;">
            <div class="ve-field">
              <label class="ve-label">年代選択 (ERA)</label>
              <select id="ve-vintage-dropdown" class="ve-select">
                <option value="10s">10s</option>
                <option value="00s~">00s~</option>
                <option value="00s" selected>00s</option>
                <option value="90~00s">90~00s</option>
                <option value="90s">90s</option>
                <option value="80~90s">80~90s</option>
                <option value="80s">80s</option>
              </select>
            </div>
          </div>

          <div class="ve-field">
            <label class="ve-label">TITLE <span id="ai-title-cnt">0/40</span></label>
            <div style="display:flex; gap:5px; margin-bottom:5px;">
              <button id="ai-copy-title" class="ve-master-btn btn-mini" style="flex:1;">コピー</button>
            </div>
            <textarea id="ai-title-out" class="ve-textarea ai-output-area" style="height:40px;"></textarea>
          </div>
          <div class="ve-field" style="margin-top:10px;">
            <label class="ve-label">DESCRIPTION</label>
            <div style="display:flex; gap:5px; margin-bottom:5px;">
              <button id="ai-copy-desc" class="ve-master-btn btn-mini" style="flex:1;">コピー</button>
            </div>
            <textarea id="ai-desc-out" class="ve-textarea ai-output-area" style="height:100px;"></textarea>
          </div>

          <div style="display:flex; gap:5px; margin-top:15px;">
            <button id="ai-fix-all" class="ve-master-btn btn-ai" style="flex:1; padding:10px 2px;">✨ 一括修正</button>
            <button id="ai-proofread-desc" class="ve-master-btn btn-warning" style="flex:1; padding:10px 2px;">📝 AI校正</button>
            <button id="ai-transfer" class="ve-master-btn btn-success" style="flex:1; padding:10px 2px;">🚀 転送</button>
          </div>
        `;
        h1.parentNode.insertBefore(panel, launcher.nextSibling);
        UI.setupAiEvents(panel, launcher);
      });
    },

    createLauncher: () => {
      if (document.getElementById(CONFIG.LAUNCHER_ID)) return;
      const l = document.createElement('div');
      l.id = CONFIG.LAUNCHER_ID;
      l.innerHTML = 'E';
      l.onclick = () => {
        const p = document.getElementById(CONFIG.PANEL_ID);
        if (p) {
          p.style.display = 'flex';
          l.style.display = 'none';
          Storage.setVintagePanelState(true);
        }
      };
      document.body.appendChild(l);
      Storage.getVintagePanelState().then(isOpen => {
        if (isOpen) l.onclick();
      });
    },

    remove: () => {
      [CONFIG.PANEL_ID, CONFIG.LAUNCHER_ID, 'ai-extender-panel', 'ai-extender-launcher'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
      });
    },

    loadSelectOptions: (panel) => {
      const tplSel = panel.querySelector('#ve-template');
      const hashSel = panel.querySelector('#ve-hashtag-rules');
      
      Object.keys(StateManager.state.templates).forEach(name => {
        const opt = new Option(name, name);
        tplSel.add(opt);
      });
      Object.keys(StateManager.state.hashtags_map).forEach(cat => {
        const opt = new Option(cat, cat);
        hashSel.add(opt);
      });

      // テンプレートとハッシュタグの初期値をセットし、変更を通知
      Storage.getVeActiveTemplate().then(savedTpl => {
        // 保存されたテンプレートが存在するか確認、なければ「小物」
        if (StateManager.state.templates[savedTpl]) {
          tplSel.value = savedTpl;
        } else {
          tplSel.value = '小物';
        }
        hashSel.value = '生活小物';
        tplSel.dispatchEvent(new Event('change'));
        hashSel.dispatchEvent(new Event('change'));
      });
    },

    updateHistoryUI: async (panel) => {
      const hist = await Storage.getHistory();
      panel.querySelectorAll('.ve-hist-btn').forEach((btn, i) => {
        if (hist[i]) {
          btn.disabled = false; btn.style.opacity = '1'; btn.title = hist[i].item_name;
          btn.onclick = () => {
            panel.querySelector('#ve-item-name').value = hist[i].item_name;
            panel.querySelector('#ve-free-word').value = hist[i].memo || '';
            
            // IDリストア表示
            const idEl = panel.querySelector('#ve-next-id');
            const labelEl = panel.querySelector('#ve-id-label');
            idEl.innerText = hist[i].purchase_id || '???';
            idEl.style.color = '#ffc107';
            idEl.setAttribute('data-restored', 'true');
            labelEl.innerText = 'RESTORED ID';
            labelEl.style.color = '#ffc107';

            panel.querySelector('#ve-item-name').dispatchEvent(new Event('input'));
          };
        }
      });
    },

    setupVintageEvents: (panel) => {
      const update = (e) => {
        const title = panel.querySelector('#ve-item-name').value;
        const freeWord = panel.querySelector('#ve-free-word').value;
        const price = panel.querySelector('#ve-price').value;
        const disc = panel.querySelector('#ve-discount').value;
        const tplName = panel.querySelector('#ve-template').value;
        const condKey = panel.querySelector('#ve-condition').value;

        // タイトル変更時のみハッシュタグを自動選択（手動変更を尊重）
        if (e && e.target && e.target.id === 've-item-name') {
          const autoCat = Logic.HashtagSelector.selectByTitle(title);
          panel.querySelector('#ve-hashtag-rules').value = autoCat;
        }

        const cat = panel.querySelector('#ve-hashtag-rules').value;
        panel.querySelector('#ve-char-cnt').innerText = `${title.length}/40`;
        panel.querySelector('#ve-char-cnt').style.color = title.length > 40 ? '#ff4d4f' : '#888';

        const calcPrice = Logic.PriceCalc.calculate(price, disc);
        panel.querySelector('#ve-calc-price').innerText = '¥' + calcPrice.toLocaleString();

        const rendered = Logic.TemplateEngine.render(StateManager.state.templates[tplName], {
          "{title}": title, "{description}": freeWord,
          "{product_id}": panel.querySelector('#ve-next-id').innerText,
          "{hashtags}": StateManager.state.hashtags_map[cat] || "",
          "{full_condition}": CONFIG.CONDITION_MAP[condKey]
        });
        panel.querySelector('#ve-word-output').value = rendered;
      };

      // プレビュー欄（#ve-word-output）以外を更新トリガーにする
      ['#ve-item-name', '#ve-free-word', '#ve-price', '#ve-discount', '#ve-template', '#ve-condition', '#ve-hashtag-rules'].forEach(id => {
        const el = panel.querySelector(id);
        if (!el) return;
        el.oninput = (e) => update(e);
        el.onchange = (e) => {
          if (el.id === 've-template') {
            Storage.setVeActiveTemplate(el.value); // 保存
          }
          update(e);
        };
      });      panel.querySelector('.ve-close').onclick = () => {
        panel.style.display = 'none'; document.getElementById(CONFIG.LAUNCHER_ID).style.display = 'flex';
        Storage.setVintagePanelState(false);
      };

      panel.querySelector('#ve-proofread-btn').onclick = async (e) => {
        const textarea = panel.querySelector('#ve-word-output');
        const text = textarea.value;
        if (!text) return alert('校正するテキストを入力してください');
        
        const btn = e.target;
        const oldTxt = btn.innerText;
        btn.disabled = true; btn.innerText = '校正中...';
        
        const res = await Common.API.refineContent('test_extension_proofread', { text });
        if (res.success) {
          textarea.value = res.refined_text;
          // ※プレビュー欄を直接書き換えるため、他の入力による update() で上書きされないよう注意
          btn.innerText = '✨ 校正完了！';
        } else {
          btn.innerText = '❌ エラー';
        }
        setTimeout(() => { btn.disabled = false; btn.innerText = oldTxt; }, 2000);
      };

      panel.querySelector('#ve-fetch-ai-btn').onclick = async () => {
        const data = await Automator.loadAiData({
          onSet: (d) => {
            panel.querySelector('#ve-item-name').value = d.title;
            panel.querySelector('#ve-free-word').value = d.description;
            update();
          }
        });
        if (!data) alert('吸い上げるAIデータがありません');
      };

      panel.querySelector('#ve-save-btn').onclick = async () => {
        const status = panel.querySelector('#ve-status');
        const data = {
          item_name: panel.querySelector('#ve-item-name').value,
          template_name: panel.querySelector('#ve-template').value,
          cond2: panel.querySelector('#ve-condition').value,
          purchase_price: panel.querySelector('#ve-calc-price').innerText.replace(/[¥,]/g, ''),
          memo: panel.querySelector('#ve-memo').value,
          purchase_id: panel.querySelector('#ve-next-id').innerText,
          word_textla: panel.querySelector('#ve-word-output').value
        };
        if (!data.item_name) return alert('商品名を入力してください');

        // --- 先にメルカリ画面へ同期 (爆速化) ---
        Automator.syncToMercari('input[inputmode="text"]', data.item_name);
        Automator.syncToMercari([
          'textarea.merInputNode',
          '.merInputNode textarea',
          'textarea[name="description"]'
        ], data.word_textla);

        status.innerText = 'Saving...';
        const res = await Common.API.saveProduct(data);
        if (res.success) {
          // 履歴保存 (新メソッド)
          await Storage.saveHistory(data);
          
          status.innerText = '✅ Saved & Synced!';

          // --- フォームのクリア (保存成功後に実行) ---
          ['#ve-item-name', '#ve-free-word', '#ve-memo'].forEach(sel => {
            const el = panel.querySelector(sel);
            if (el) el.value = '';
          });

          // 次のIDを取得してUIを更新
          await StateManager.init();
          panel.querySelector('#ve-next-id').innerText = StateManager.state.nextId;
          update();

          setTimeout(() => { status.innerText = ''; UI.updateHistoryUI(panel); }, 2000);
        }
      };

      // 初期プレビューの反映
      update();

      // 自動インポート処理 (転送予約がある場合)
      Automator.loadAiData({
        onSet: (d) => {
          if (d.isNew) {
            panel.querySelector('#ve-item-name').value = d.title;
            panel.querySelector('#ve-free-word').value = d.description;
            update();
            // フラグを落として再保存 (新メソッド)
            Storage.markAiDataUsed();
            
            const status = panel.querySelector('#ve-status');
            if (status) {
              status.innerText = '✨ AIデータを自動インポートしました';
              setTimeout(() => { status.innerText = ''; }, 3000);
            }
          }
        }
      });
    },

    setupAiEvents: (panel, launcher) => {
      let currentMode = 'normal'; // normal or vintage

      // 状態の復元 (開閉状態 + タブ)
      Storage.getAiPanelState().then(isOpen => {
        if (isOpen) {
          panel.style.display = 'flex';
          launcher.style.display = 'none';
        } else {
          panel.style.display = 'none';
          launcher.style.display = 'inline-flex';
        }
      });

      const tabs = panel.querySelectorAll('.ve-tab');
      const vintageContent = panel.querySelector('#ve-tab-content-vintage');

      Storage.getAiActiveTab().then(savedTab => {
        currentMode = savedTab;
        tabs.forEach(t => {
          if (t.dataset.tab === savedTab) t.click();
        });
      });

      // タブ切り替えロジック
      tabs.forEach(tab => {
        tab.onclick = () => {
          tabs.forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          currentMode = tab.dataset.tab;
          Storage.setAiActiveTab(currentMode); // 保存
          
          if (currentMode === 'vintage') {
            vintageContent.classList.add('active');
          } else {
            vintageContent.classList.remove('active');
          }
        };
      });

      // トグルロジック
      if (launcher) {
        launcher.onclick = () => {
          panel.style.display = 'flex';
          launcher.style.display = 'none';
          Storage.setAiPanelState(true);
        };
      }

      const closeBtn = panel.querySelector('#ai-panel-close');
      if (closeBtn) {
        closeBtn.onclick = () => {
          panel.style.display = 'none';
          launcher.style.display = 'inline-flex';
          Storage.setAiPanelState(false);
        };
      }

      const runRefine = async (type, btn) => {
        const originalText = btn ? btn.innerText : '';
        if (btn) { btn.disabled = true; btn.innerText = '実行中...'; }
        
        const pageData = Logic.Scraper.extractPageData();
        
        // モードに応じたエンドポイントの分岐フック
        let endpoint = type === 'title' ? 'title_refine' : 'description_refine';
        if (currentMode === 'vintage') {
          endpoint += '_v2';
        }

        const res = await Common.API.refineContent(endpoint, 
          type === 'title' ? { title: pageData.title, brand: pageData.brand } : { text: pageData.description });
        
        if (res.success) {
          const out = panel.querySelector(type === 'title' ? '#ai-title-out' : '#ai-desc-out');
          if (out) {
            let finalValue = type === 'title' ? res.refined_title : res.refined_text;

            // 古着モードかつタイトルの場合のみ、接頭辞をハードコード結合
            if (currentMode === 'vintage' && type === 'title') {
              const eraValue = panel.querySelector('#ve-vintage-dropdown').value;
              const suffix = ['80~90s', '90s', '80s'].includes(eraValue) ? '_vintage' : '_archive';
              finalValue = `【${eraValue}${suffix}】${finalValue}`;
            }

            out.value = finalValue;
            if (type === 'title') {
              out.dispatchEvent(new Event('input'));
            }
          }
        }
        if (btn) { btn.disabled = false; btn.innerText = originalText; }
      };

      const setupCopy = (btnId, outId) => {
        const btn = panel.querySelector('#' + btnId);
        if (btn) {
          btn.onclick = () => {
            const out = panel.querySelector('#' + outId);
            const val = out ? out.value : '';
            if (!val) return;
            navigator.clipboard.writeText(val).then(() => {
              const old = btn.innerText; btn.innerText = 'OK!';
              setTimeout(() => { btn.innerText = old; }, 1000);
            });
          };
        }
      };

      const fixAllBtn = panel.querySelector('#ai-fix-all');
      if (fixAllBtn) {
        fixAllBtn.onclick = async (e) => {
          e.target.disabled = true; e.target.innerText = '実行中...';
          await Promise.all([runRefine('title'), runRefine('description')]);
          e.target.disabled = false; e.target.innerText = '一括AI修正';
        };
      }

      setupCopy('ai-copy-title', 'ai-title-out');
      setupCopy('ai-copy-desc', 'ai-desc-out');

      const aiProofBtn = panel.querySelector('#ai-proofread-desc');
      if (aiProofBtn) {
        aiProofBtn.onclick = async (e) => {
          const textarea = panel.querySelector('#ai-desc-out');
          const text = textarea.value;
          if (!text) return alert('校正するテキストを入力してください');

          const btn = e.target;
          const oldTxt = btn.innerText;
          btn.disabled = true; btn.innerText = '校正中...';

          const res = await Common.API.refineContent('test_extension_proofread', { text });
          if (res.success) {
            textarea.value = res.refined_text;
            btn.innerText = '✨ 校正完了！';
          } else {
            btn.innerText = '❌ エラー';
          }
          setTimeout(() => { btn.disabled = false; btn.innerText = oldTxt; }, 2000);
        };
      }

      // リアルタイムカウンターの追加 (40文字制限)
      const aiTitleOut = panel.querySelector('#ai-title-out');
      const aiTitleCnt = panel.querySelector('#ai-title-cnt');
      if (aiTitleOut && aiTitleCnt) {
        const updateAiCounter = () => {
          const len = aiTitleOut.value.length;
          aiTitleCnt.innerText = `${len}/40`;
          aiTitleCnt.style.color = len > 40 ? '#ff4d4f' : '#888';
          aiTitleCnt.style.fontWeight = len > 40 ? 'bold' : 'normal';
        };
        aiTitleOut.oninput = updateAiCounter;
        updateAiCounter(); // 初期表示反映
      }

      const transferBtn = panel.querySelector('#ai-transfer');
      if (transferBtn) {
        transferBtn.onclick = async (e) => {
          const titleOut = panel.querySelector('#ai-title-out');
          const descOut = panel.querySelector('#ai-desc-out');
          const title = titleOut ? titleOut.value : '';
          const description = descOut ? descOut.value : '';
          
          if (!title && !description) return alert('修正後の内容がありません');

          await Automator.queueAiData(title, description);
          
          const btn = e.target;
          const old = btn.innerText;
          btn.innerText = '✨ 転送予約完了！';
          setTimeout(() => { btn.innerText = old; }, 2000);
        };
      }
    }
  };

  // =========================================
  // 層 7: Router / Orchestrator (ルーター層)
  // =========================================
  const Routes = {
    vintage: (ctx) => {
      Common.logger.log("Entering Vintage Route");
      StyleModule.inject(ctx);
      UI.createVintagePanel();
      UI.createLauncher();

      // 下書きページ且つオートメーションハッシュがある場合のみ自動開始
      if (ctx.url.includes('/sell/draft/') && window.location.hash.includes('auto_analyze')) {
        const mode = Logic.Workflow.detectMode();
        
        // 解析開始のスケジューリング
        const startAutomation = () => {
          const waitTime = mode === 'standard' ? 5000 : 3000;
          console.log(`[Workflow] Waiting ${waitTime}ms for ${mode.toUpperCase()} mode...`);
          
          setTimeout(() => {
            if (document.readyState === 'complete') {
              Logic.Workflow.start();
            } else {
              console.log("[Workflow] DOM not ready, waiting for load event...");
              window.addEventListener('load', () => Logic.Workflow.start(), { once: true });
            }
          }, waitTime);
        };

        startAutomation();
      }
    },
    ai: (ctx) => {
      Common.logger.log("Entering AI Route");
      StyleModule.inject(ctx);
      UI.createAiPanel();
    },
    listing: async (ctx) => {
      Common.logger.log("Entering Listing Route (Visual Bullet Loader)");
      
      const isAutoPilot = window.location.hash.includes('auto_pilot');
      if (!isAutoPilot) return;

      console.log("[Workflow] Auto-Pilot detected. Initializing mode sensing...");
      await Logic.Workflow.fetchModeActive();

      // 各行に Bullet ボタンを配置する関数
      const injectBullets = () => {
        const mode = localStorage.getItem('ve_auto_mode') || 'standard';
        const items = document.querySelectorAll('a[href*="/sell/draft/"]');
        
        items.forEach(a => {
          if (a.querySelector('.ve-bullet-btn')) return; // 重複挿入防止

          const bullet = document.createElement('button');
          bullet.className = 've-bullet-btn';
          bullet.innerText = '[READY]';
          bullet.dataset.status = 'ready';
          
          // スタイル設定（未処理は緑）
          Object.assign(bullet.style, {
            marginLeft: '10px', padding: '4px 8px', borderRadius: '4px',
            fontSize: '11px', fontWeight: 'bold', border: 'none',
            cursor: 'pointer', background: '#28a745', color: 'white'
          });

          bullet.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (bullet.dataset.status === 'done') return;

            const baseHref = a.href.split('#')[0];
            const bulletUrl = `${baseHref}#auto_analyze&mode=${mode}`;
            
            bullet.innerText = '[SHOT]';
            bullet.dataset.status = 'processing';
            bullet.style.background = '#007bff'; // 処理中は青
            Logic.Workflow.state.isProcessing = true;

            console.log(`[Workflow] 🚀 Bullet Shot: ${bulletUrl}`);
            window.open(bulletUrl, '_blank');
          };

          // リンクの横、または適切なコンテナ内に挿入
          const container = a.querySelector('div[class*="merListItem"]') || a;
          container.appendChild(bullet);
        });
      };

      // 初回注入とDOM監視による動的注入
      injectBullets();
      const observer = new MutationObserver(injectBullets);
      observer.observe(document.body, { childList: true, subtree: true });

      // 10秒ごとのポーリング（Pauling）
      Logic.Workflow.state.listingTimer = setInterval(() => {
        if (!isAutoPilot || Logic.Workflow.state.isProcessing) {
          // 完了信号をチェック
          const isCompleted = localStorage.getItem('ve_process_completed') === 'true';
          if (isCompleted) {
            const lastId = localStorage.getItem('ve_last_processed_id');
            const bullets = document.querySelectorAll('.ve-bullet-btn[data-status="processing"]');
            
            bullets.forEach(b => {
              const link = b.closest('a');
              if (!link || !lastId || link.href.includes(lastId)) {
                console.log(`[Workflow] 🏁 Done signal received for ${lastId}. Marking as COMPLETE_NICE.`);
                b.innerText = '[COMPLETE_NICE]';
                b.dataset.status = 'complete_nice';
                b.style.background = '#fd7e14'; // オレンジを維持
                Logic.Workflow.state.isProcessing = false;
                localStorage.removeItem('ve_process_completed');
              }
            });
          }
          return;
        }

        // 次の READY なボタンを探してクリック
        const nextBtn = document.querySelector('.ve-bullet-btn[data-status="ready"]');
        if (nextBtn) {
          const delay = Math.floor(Math.random() * 3000) + 2000; // 2000-5000ms
          console.log(`[Workflow] Pauling: Found next bullet. Waiting ${delay/1000}s before shooting...`);
          
          setTimeout(() => {
            // 待機中に状態が変わっていないか最終確認してクリック
            if (!Logic.Workflow.state.isProcessing && nextBtn.dataset.status === 'ready') {
              nextBtn.click();
            }
          }, delay);
        } else {
          const allBullets = document.querySelectorAll('.ve-bullet-btn');
          const isAllDone = allBullets.length > 0 && Array.from(allBullets).every(b => b.dataset.status === 'complete_nice');
          
          if (isAllDone) {
            console.log("[Workflow] 🏆 ALL COMPLETE! All bullets in view are finished.");
            
            // Phase 4: Server 5 連携とプロファイル・ブリッジ
            const currentMode = Logic.Workflow.state.mode; // "vintage" or "standard"
            const nextSignal = (currentMode === 'vintage') ? '5' : '6';
            console.log(`[Workflow] 📡 Sending Session Complete Signal (${nextSignal}) for ${currentMode.toUpperCase()} mode to Server 5...`);
            
            fetch('http://127.0.0.1:12765/notify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ signal: nextSignal })
            }).catch(err => console.error("[Workflow] ❌ Failed to notify Server 5:", err));

            // 全完了したらポーリングを停止してクリーンアップ
            clearInterval(Logic.Workflow.state.listingTimer);
            Logic.Workflow.state.listingTimer = null;
            
            // localStorage のモード情報を削除（次のセッションでの再判定を促す）
            localStorage.removeItem('ve_auto_mode');
          } else {
            console.log("[Workflow] Pauling: No more unprocessed items in current list view.");
          }
        }
      }, 10000);
    },
    cleanup: () => {
      Common.logger.log("Cleaning up for SPA transition");
      if (Logic.Workflow.state.listingTimer) {
        clearInterval(Logic.Workflow.state.listingTimer);
        Logic.Workflow.state.listingTimer = null;
      }
      Logic.Workflow.state.isProcessing = false;
      UI.remove();
      StyleModule.remove();
    }
  };

  const Core = {
    lastPath: '',
    run: async () => {
      const ctx = Common.getContext();
      if (ctx.url === Core.lastPath) return;
      Core.lastPath = ctx.url;

      Routes.cleanup(); // SPA 遷移時は一旦全破棄

      if (ctx.isVintage) await Routes.vintage(ctx);
      else if (ctx.isAi) await Routes.ai(ctx);
      else if (ctx.isListing) await Routes.listing(ctx);
    },
    init: async () => {
      Common.logger.log("Initializing Master Rebuild v3.0...");
      if (!window.location.hash.includes('auto_analyze')) {
        await StateManager.init();
      }
      Core.run();
      new MutationObserver(Core.run).observe(document.body, { childList: true, subtree: true });
    }
  };

  Core.init();
})();
