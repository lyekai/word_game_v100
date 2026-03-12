let currentLevel = 1; 
let levelDataCache = []; 
let currentSentencePrompt = ""; 
let feedbackCount = 0; // 新增：追蹤 AI 回饋次數

const words = [
"universe","crocodile","jellyfish","farm","cow","chicken","turtle","umbrella","raining",
"pigeon","penguin","fence","waterfall","elephant","bird","bunny","desert","wolf","rock",
"zebra","lion","boat","ocean","whale","cat","moon","night","koala","ice","grass","puppy",
"parrot","forest","snow","rose","duck","tiger","horse","goose","mountain","dessert","fish"
];
function updateStars(type, count) {
const selector = type === 'word' ? '.word-star' : '.sentence-star';
const starGroup = document.querySelectorAll(selector);
starGroup.forEach((star, index) => {
if (index < count) {
    star.classList.add('lit');
} else {
    star.classList.remove('lit');
}
});
}

function typeEffect(elementId, text, delay = 30, callback = null) {
    const container = document.getElementById(elementId);
    container.innerHTML = ''; // 清空容器
    
    // 創建一個用來顯示文字的 element
    const outputElement = document.createElement('div');
    // 重要：這行讓 \n 變成真正的換行
    outputElement.style.whiteSpace = 'pre-wrap'; 
    outputElement.style.lineHeight = '1.6'; // 讓行距美觀一點
    container.appendChild(outputElement);
    
    let i = 0;
    const feedBackBox = document.querySelector(".feed-back"); 
    
    function typing() {
        if (i < text.length) {
            // 統一使用 textContent，這樣最安全，也不會誤解析標籤
            outputElement.textContent += text.charAt(i);
            i++;
            
            // 自動滾動到底部
            if(feedBackBox) feedBackBox.scrollTop = feedBackBox.scrollHeight;
            
            setTimeout(typing, delay);
        } else if (callback) { 
            callback(); 
        }
    }
    typing();
}

async function showModal() {
    const levelData = levelDataCache.find(item => Number(item.level) === Number(currentLevel));
    const userSentence = document.getElementById("sentence-input").value.trim();
    
    const currentWordStars = document.querySelectorAll('.word-star.lit').length;
    const currentSentenceStars = document.querySelectorAll('.sentence-star.lit').length;
    const totalStars = currentWordStars + currentSentenceStars;

    const originalImg = document.getElementById("generated-image");
    const aiImg = document.getElementById("ai-generated-image");
    const loading = document.getElementById("ai-loading-placeholder");
    const footer = document.querySelector(".modal-footer"); 

    // 初始化 Modal
    if (levelData) originalImg.src = levelData.image_origin;
    loading.classList.remove("hidden");
    loading.textContent = "AI 老師正在繪製高品質插畫..."; 
    aiImg.classList.add("hidden");
    footer.style.display = "none"; // 生圖中先隱藏按鈕

    // 顯示視窗並播放星星動畫
    document.getElementById("image-modal").classList.add("visible");
    playStarAnimation(totalStars);

    // 🚀 重點：生圖開始前先執行進度存檔 (確保即使網路斷掉也有過關紀錄)
    handleFinalSave();

    try {
        const response = await fetch("/api/generate_image", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                mode: 'easy',
                user_sentence: userSentence,
                level: currentLevel,
                word_stars: currentWordStars,
                sentence_stars: currentSentenceStars
            })
        });
        
        const result = await response.json();
        if (result.image_url && result.status === "success") {
            aiImg.src = result.image_url;
            aiImg.onload = () => {
                loading.classList.add("hidden");
                aiImg.classList.remove("hidden");
                footer.style.display = "flex"; 
                
                // 圖片成功後存入作品集
                saveToPortfolio({
                    image: result.image_url, 
                    mode: '簡單模式',
                    level: currentLevel,
                    sentence: userSentence,
                    stars: totalStars,
                    time: new Date().toLocaleString()
                });
            };
        } else {
            throw new Error("API 回傳失敗");
        }
    } catch (e) {
        loading.textContent = "生圖功能暫時休息，不影響過關，請點擊下一關。";
        footer.style.display = "flex";
    }
}

function loadLevel(level, isReplay = false) {
    // 1. 基本邊界檢查：確保關卡編號在範圍內
    if (level > levelDataCache.length) { level = 1; }
    if (level < 1) { level = 1; }
    
    const levelData = levelDataCache.find(item => item.level === level);
    if (!levelData) return;
    
    // 2. 更新當前狀態
    currentLevel = level;
    feedbackCount = 0; // 【關鍵】重置回饋次數，讓新關卡從 0 開始計算
    
    // 3. 更新畫面上方的關卡圓圈 UI
    document.querySelectorAll(".level-circle").forEach(c => {
        c.classList.remove("active");
        if (parseInt(c.textContent) === level) c.classList.add("active");
    });

    // 4. 更新模糊圖片與提示文字
    document.getElementById("vague-image").src = levelData.image_vague;
    document.getElementById("tip1").textContent = levelData.tip[0];
    document.getElementById("tip2").textContent = levelData.tip[1];
    document.getElementById("tip3").textContent = levelData.tip[2];

    // 5. 如果不是「重玩本關」，則清空所有輸入內容
    if (!isReplay) {
        // 清空三個單字格子
        document.querySelectorAll(".answer-box").forEach(b => { 
            b.textContent = ""; 
            b.classList.remove("incorrect", "correct", "correct-locked"); 
        });

        // 清空輸入框與 AI 回饋區
        document.getElementById("sentence-input").value = "";
        document.getElementById("feedback-container").innerHTML = "";

        // 【關鍵】將按鈕文字改回初始的「確認」
        const confirmBtn = document.querySelector(".confirm-btn");
        if (confirmBtn) {
            confirmBtn.textContent = "確認";
            confirmBtn.disabled = false; // 確保按鈕不是禁用狀態
        }

        // 重新渲染下方單字卡片並隨機抽取新的句型提示
        renderCards(); 
        setSentencePrompt(levelData);
    }

    // 6. 更新按鈕顯示狀態（檢查單字是否選滿、句子是否輸入）
    updateConfirmButton();

    // 7. 清空畫面的星星狀態（讓它們熄滅）
    document.querySelectorAll(".star").forEach(s => s.classList.remove("lit"));
}

function renderCards() {
    const container = document.querySelector(".cards");
    const taken = Array.from(document.querySelectorAll(".answer-box")).map(b => b.textContent.trim()).filter(w => w !== "");
    container.innerHTML = "";
    [...words].sort().forEach(word => {
        if (taken.includes(word)) return;
        const card = document.createElement("div");
        card.className = "card";
        card.textContent = word;
        card.dataset.word = word;
        container.appendChild(card);
    });
}

function setSentencePrompt(levelData) {
    const p = document.querySelector("#sentence p");
    if (levelData?.sentence?.length > 0) {
        currentSentencePrompt = levelData.sentence[Math.floor(Math.random() * levelData.sentence.length)];
        p.innerHTML = `請用選擇的三個單字造一個句子 (${currentSentencePrompt})`;
    }
}

function updateConfirmButton() {
    const a1 = document.getElementById("answer1").textContent.trim();
    const a2 = document.getElementById("answer2").textContent.trim();
    const a3 = document.getElementById("answer3").textContent.trim();
    const s = document.getElementById("sentence-input").value.trim();
    
    const isCardsFull = (a1 !== "" && a2 !== "" && a3 !== "");
    document.querySelector(".submit-btn").classList.toggle("hidden", !isCardsFull);

    const isSentenceReady = (s !== "");
    document.querySelector(".confirm-btn").classList.toggle("hidden", !isSentenceReady);
    // 移除舊 generate-image-btn 的顯示逻辑
}

function handleSubmitAnswer() {
    const levelData = levelDataCache.find(item => item.level === currentLevel);
    if (!levelData) return;
    const userBoxes = [document.getElementById("answer1"), document.getElementById("answer2"), document.getElementById("answer3")];
    const corrects = levelData.answer.map(w => w.toLowerCase());

    userBoxes.forEach(box => {
        const word = box.textContent.trim().toLowerCase();
        box.classList.remove("incorrect", "correct", "correct-locked");
        if (corrects.includes(word)) {
            box.classList.add("correct", "correct-locked"); 
        } else if (word !== "") {
            box.classList.add("incorrect"); 
        }
    });
    const correctCount = document.querySelectorAll(".answer-box.correct").length;
    updateStars('word', correctCount);
}
function evaluateSentenceStars(sentence, userWords) {
    let stars = 0;
    const s = sentence.trim();
    const sLower = s.toLowerCase();
    
    // --- 準備檢測工具 ---
    // 1. 句型門檻檢測 (符合 These are... 或 What is... doing?)
    const hasPattern = /\b(these|those|they are)\b/i.test(sLower) || /\bwhat (is|are) .+ doing\b/i.test(sLower);
    
    // 2. 單字應用檢測 (包含至少 3 個選擇的單字)
    const usedCount = userWords.filter(w => sLower.includes(w.toLowerCase())).length;
    
    // 3. 格式與基礎文法檢測
    const hasSubject = /\b(i|you|he|she|it|we|they|the|this|that|these|those)\b/i.test(sLower);
    const hasVerb = /\b(is|am|are|was|were|be|have|has|do|does|did|can|could|will|should)\b/i.test(sLower);
    const properFormat = /^[A-Z]/.test(s) && /[.!?]$/.test(s); // 首字大寫且標點結尾
    const noSpacingIssue = !(/\s[.,!?;:]|[.,!?;:](?!\s|$)|\s{2,}/.test(s)); // 標點空格正確
    
    // 4. 進階豐富度
    const wordCount = s.split(/\s+/).filter(w => w.length > 0).length;
    const hasAdjective = /\b(beautiful|big|small|happy|sad|red|blue|green|yellow|white|black|fast|slow|good|nice)\b/i.test(sLower);

    // --- 階層式給星 (1-4 顆造句星) ---
    
    // ⭐ 第 1 顆造句星 (總計第 4 顆)：必須符合句型提示
    if (hasPattern) {
        stars = 1;

        // ⭐ 第 2 顆造句星 (總計第 5 顆)：必須符合句型 + 用對 3 個單字
        if (usedCount >= 3) {
            stars = 2;

            // ⭐ 第 3 顆造句星 (總計第 6 顆)：格式正確 + 有主謂 + 無空格錯誤
            if (properFormat && hasSubject && hasVerb && noSpacingIssue) {
                stars = 3;

                // ⭐ 第 4 顆造句星 (總計第 7 顆)：句子長度 >= 6 且有形容詞 (流暢度獎勵)
                if (wordCount >= 6 && hasAdjective) {
                    stars = 4;
                }
            }
        }
    }

    updateStars('sentence', stars);
}

async function handleConfirm() {
    const btn = document.querySelector(".confirm-btn");
    const sentenceInput = document.getElementById("sentence-input");
    const levelData = levelDataCache.find(item => item.level === currentLevel);
    
    if (!levelData) return;

    const userBoxes = [document.getElementById("answer1"), document.getElementById("answer2"), document.getElementById("answer3")];
    const userWords = userBoxes.map(b => b.textContent.trim().toLowerCase()).filter(w => w !== "");
    
    // 計算星星
    evaluateSentenceStars(sentenceInput.value.trim(), userWords);

    const currentWordStars = document.querySelectorAll('.word-star.lit').length;
    const currentSentenceStars = document.querySelectorAll('.sentence-star.lit').length;

    // --- 修改重點：門檻改為 2 ---
    // 當 feedbackCount 等於 2 時，代表已經按過「確認」(0) 和「再造一次」(1)
    if (feedbackCount >= 2) { 
        showModal();
        return;
    }

    const corrects = levelData.answer.map(w => w.toLowerCase());
    const missing = corrects.filter(w => !userWords.includes(w));
    
    btn.disabled = true;
    document.getElementById("feedback-container").innerHTML = "🤖 AI 老師正在閱卷並記錄學習進度...";

    try {
        const res = await fetch("/api/ai_feedback", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                mode: 'easy',
                level: currentLevel, 
                missing_words: missing, 
                user_sentence: sentenceInput.value.trim(), 
                sentence_prompt: currentSentencePrompt, 
                correct_words: userWords,
                feedback_count: feedbackCount,
                word_stars: currentWordStars,
                sentence_stars: currentSentenceStars
            })
        });
        
        const data = await res.json();
        
        typeEffect('feedback-container', data.feedback, 30, () => {
            feedbackCount++; // 累加次數
            btn.disabled = false;

            // --- 修改重點：判斷下次按鈕文字 ---
            if (feedbackCount < 2) {
                btn.textContent = "再造一次";
            } else {
                btn.textContent = "生成圖片";
            }
            updateConfirmButton();
        });
    } catch (e) {
        document.getElementById("feedback-container").innerHTML = "連線失敗。";
        btn.disabled = false;
    }
}

window.addEventListener("DOMContentLoaded", () => {
    document.querySelector(".cards").addEventListener("click", e => {
        if (!e.target.classList.contains("card")) return;
        const emptyBox = [
            document.getElementById("answer1"),
            document.getElementById("answer2"),
            document.getElementById("answer3")
        ].find(b => b.textContent.trim() === "");
        
        if (emptyBox) {
            emptyBox.textContent = e.target.dataset.word; 
            e.target.remove(); 
            updateConfirmButton(); 
        }
    });

    document.querySelectorAll(".answer-box").forEach(box => {
        box.addEventListener("click", () => {
            if (box.textContent === "" || box.classList.contains("correct-locked")) return;
            box.textContent = ""; 
            box.classList.remove("incorrect", "correct");
            renderCards(); 
            updateConfirmButton();
        });
    });

    document.getElementById("sentence-input").addEventListener("input", () => {
        // 修改句子時，不需要重置回饋次數，只需確認按鈕是否顯示
        updateConfirmButton();
    });

    document.querySelector(".confirm-btn").addEventListener("click", handleConfirm);
    document.querySelector(".submit-btn").addEventListener("click", handleSubmitAnswer); 
    
    // 移除舊 generate-image-btn 的事件監聽

    document.getElementById("next-level-btn").addEventListener("click", () => { 
        document.getElementById("image-modal").classList.remove("visible");
        
        // 點擊下一關時再次確認存檔
        handleFinalSave(); 

        // 清除 Modal 星星狀態
        document.querySelectorAll(".m-star").forEach(s => s.classList.remove("lit"));
        
        setTimeout(() => {
            loadLevel(currentLevel + 1); 
        }, 100);
    });
    
    fetch("/static/data/easy_mode.json")
        .then(res => res.json())
        .then(data => { 
            levelDataCache = data; 
            const urlParams = new URLSearchParams(window.location.search);
            const levelParam = urlParams.get('level');
            loadLevel(levelParam ? parseInt(levelParam) : 1);
        });
});

function saveToPortfolio(data) {
    try {
        let portfolio = JSON.parse(localStorage.getItem('userPortfolio')) || [];
        
        // --- 移除重複檢查，直接存入 ---
        portfolio.unshift(data); // 新作品放在陣列最前面
        
        // 限制數量防止瀏覽器儲存空間 (localStorage) 爆失控
        if (portfolio.length > 50) {
            portfolio.pop(); // 移除最舊的一筆
        }
        
        localStorage.setItem('userPortfolio', JSON.stringify(portfolio));
        console.log("作品已全數存入！目前總數:", portfolio.length);
        
    } catch (e) {
        console.error("作品集儲存失敗，可能是空間不足", e);
        alert("儲存空間已滿，請到個人作品集刪除一些舊作品哦！");
    }
}

function playStarAnimation(totalStars) {
    const modalStars = document.querySelectorAll('.m-star');
    const starAudioPath = '/static/audio/star.mp3';
    
    // 重置 Modal 星星
    modalStars.forEach(s => s.classList.remove('lit'));

    // 依序亮起
    for (let i = 0; i < totalStars; i++) {
        setTimeout(() => {
            if (modalStars[i]) {
                modalStars[i].classList.add('lit');
                const audio = new Audio(starAudioPath);
                audio.volume = 0.4;
                audio.play().catch(e => {}); 
            }
        }, i * 400); // 每 0.4 秒亮一顆
    }
}

// 🚀 修正 2：強化 handleFinalSave (解鎖進度 + 紀錄星星)
function handleFinalSave() {
    const mode = 'easy';
    const currentWordStars = document.querySelectorAll('.word-star.lit').length;
    const currentSentenceStars = document.querySelectorAll('.sentence-star.lit').length;
    const totalStars = currentWordStars + currentSentenceStars;

    // --- A. 更新星星紀錄 (Star Records) ---
    let starRecords = JSON.parse(localStorage.getItem('starRecords')) || { "easy": {}, "hard": {} };
    if (!starRecords[mode]) starRecords[mode] = {};
    
    // 只有當分數更高時才覆蓋紀錄
    const prevStars = starRecords[mode][currentLevel] || 0;
    if (totalStars > prevStars) {
        starRecords[mode][currentLevel] = totalStars;
        localStorage.setItem('starRecords', JSON.stringify(starRecords));
        console.log(`[紀錄] 模式:${mode} 關卡:${currentLevel} 最高星星更新為:${totalStars}`);
    }

    // --- B. 解鎖下一關邏輯 ---
    let progressData = JSON.parse(localStorage.getItem('gameProgress')) || { "easy": 1, "hard": 1 };
    if (currentLevel >= progressData[mode]) {
        progressData[mode] = currentLevel + 1;
        localStorage.setItem('gameProgress', JSON.stringify(progressData));
        console.log(`[進度] 模式:${mode} 已解鎖至第 ${currentLevel + 1} 關`);
    }
}
