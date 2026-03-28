let currentLevel = 1; 
let levelDataCache = []; 
let currentSentencePrompt = ""; 
let feedbackCount = 0; // 新增：追蹤 AI 回饋次數

const words = [
    "pizza","kite","grassland","computer","coffee","office","television","sofa","living room",
    "clock","blackboard","classroom","sandwich","robot","factory","bottle","badminton","gym","basketball",
    "scarf","park","glasses","madam","boutique","bathtub","toilet","bathroom","campsite","tent","guitar","magnifier",
    "pasta","scientist","hero","reporter","street","hamburger","market","earphone","wallet","donut","swimsuit"
];
function updateStars(type, count) {
    const selector = type === 'word' ? '.word-star' : '.sentence-star';
    const starGroup = document.querySelectorAll(selector);
    starGroup.forEach((star, index) => {
        if (index < count) {
            star.classList.add('active'); // 配合 CSS
        } else {
            star.classList.remove('active');
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
    
    const currentWordStars = document.querySelectorAll('.word-star.active').length;
    const currentSentenceStars = document.querySelectorAll('.sentence-star.active').length;
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
    footer.style.display = "none"; 

    document.getElementById("image-modal").classList.add("visible");
    
    // 執行動畫與存檔
    playStarAnimation(currentWordStars, currentSentenceStars);
    handleFinalSave(); 

    try {
        const response = await fetch("/api/generate_image", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                mode: 'hard',
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
                saveToPortfolio({
                    image: result.image_url, 
                    mode: '困難模式',
                    level: currentLevel,
                    sentence: userSentence,
                    wordStars: currentWordStars,      // 存入單字星數 (0-3)
                    sentenceStars: currentSentenceStars, // 存入造句星數 (0-4)
                    time: new Date().toLocaleString('zh-TW', { hour12: false })
                });
            };
        } else { throw new Error(); }
    } catch (e) {
        loading.textContent = "生圖連線異常，不影響過關。";
        footer.style.display = "flex";
    }
}

function loadLevel(level, isReplay = false) {
    const targetLevel = Number(level);
    const levelData = levelDataCache.find(item => Number(item.level) === targetLevel);
    
    if (!levelData) {
        console.error("loadLevel 找不到資料:", targetLevel);
        return;
    }
    
    currentLevel = targetLevel;
    feedbackCount = 0; // 【重要】新關卡重置回饋次數為 0
    
    document.querySelectorAll(".level-circle").forEach(c => {
        c.classList.remove("active");
        if (Number(c.textContent) === targetLevel) c.classList.add("active");
    });

    const vagueImg = document.getElementById("vague-image");
    const originalImg = document.getElementById("generated-image");

    vagueImg.src = levelData.image_vague;
    originalImg.src = levelData.image_origin; 

    document.getElementById("tip1").textContent = levelData.tip[0];
    document.getElementById("tip2").textContent = levelData.tip[1];
    document.getElementById("tip3").textContent = levelData.tip[2];

    if (!isReplay) {
        document.querySelectorAll(".answer-box").forEach(b => { 
            b.textContent = ""; 
            b.classList.remove("incorrect", "correct", "correct-locked"); 
        });
        document.getElementById("sentence-input").value = "";
        document.getElementById("feedback-container").innerHTML = "";

        // 【重要】新關卡重置按鈕文字為「確認」
        const confirmBtn = document.querySelector(".confirm-btn");
        if (confirmBtn) {
            confirmBtn.textContent = "確認";
            confirmBtn.disabled = false;
        }

        renderCards(); 
        setSentencePrompt(levelData);
    }
    updateConfirmButton();
    document.querySelectorAll(".star").forEach(s => {
        s.classList.remove("active", "lit");
    });
    document.querySelectorAll(".m-star").forEach(s => {
        s.classList.remove("active-word", "active-sentence", "lit");
    });
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
    const hasAdjective = /\b(round|square|beautiful|handsome|fragrant|delicious|colorful|expensive|cheap|smart|cute|big|huge|wide|narrow|tall|short|small|happy|sad|hot|cold|red|orange|blue|green|yellow|white|black|gray|fast|slow|good|nice|comfortable|dark|bright)\b/i.test(sLower);

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
                if (wordCount >= 20 && hasAdjective) {
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
    const levelData = levelDataCache.find(item => Number(item.level) === Number(currentLevel));
    
    if (!levelData) return;

    const userBoxes = [document.getElementById("answer1"), document.getElementById("answer2"), document.getElementById("answer3")];
    const userWords = userBoxes.map(b => b.textContent.trim().toLowerCase()).filter(w => w !== "");
    
    // --- [修正重點 1]：先計算星星，更新畫面上 class "lit" 的狀態 ---
    evaluateSentenceStars(sentenceInput.value.trim(), userWords);

    // --- [修正重點 2]：從更新後的畫面抓取正確的星星數 ---
    const currentWordStars = document.querySelectorAll('.word-star.active').length;
    const currentSentenceStars = document.querySelectorAll('.sentence-star.active').length;

    // --- [修正重點 3]：門檻由 3 次改為 2 次 ---
    // 當 feedbackCount 為 2 時，代表已經看過兩次 AI 老師的建議了
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
                mode: 'hard',
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
            feedbackCount++; // 增加回饋計數
            btn.disabled = false;

            // --- [修正重點 4]：更新按鈕文字順序 ---
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
        
        // 確保再次存檔
        handleFinalSave(); 

        // 清除 Modal 星星
        // 在 next-level-btn 的監聽器內修正：
        document.querySelectorAll(".m-star").forEach(s => {
            s.classList.remove("active-word", "active-sentence");
        });
                
        setTimeout(() => {
            loadLevel(currentLevel + 1); 
        }, 100);
    });
    
    fetch("/static/data/hard_mode.json")
        .then(res => {
            if (!res.ok) throw new Error("找不到困難模式關卡檔案");
            return res.json();
        })
        .then(data => { 
            levelDataCache = data; 
            const urlParams = new URLSearchParams(window.location.search);
            const levelParam = urlParams.get('level');
            loadLevel(levelParam ? parseInt(levelParam) : 1);
        })
        .catch(err => {
            console.error(err);
            alert("讀取關卡失敗，請檢查 /static/data/hard_mode.json 是否存在");
        });
});

function saveToPortfolio(data) {
    try {
        let portfolio = JSON.parse(localStorage.getItem('userPortfolio')) || [];
        
        // --- 移除重複檢查邏輯 ---
        // 直接將新作品加入陣列的最前面
        portfolio.unshift(data); 

        // 依然保留數量限制，防止瀏覽器 localStorage 爆失控 (建議設為 50 或 100)
        if (portfolio.length > 50) {
            portfolio.pop(); // 移除最舊的一筆
        }

        localStorage.setItem('userPortfolio', JSON.stringify(portfolio));
        console.log("作品已存入作品集！目前總數:", portfolio.length);
        
    } catch (e) {
        console.error("儲存失敗，可能是 localStorage 空間不足:", e);
        // 如果空間真的滿了（通常是存太多 Base64 圖片），提示使用者
        alert("作品集儲存空間已滿，請到個人作品集刪除一些舊作品哦！");
    }
}

// 播放 Modal 內的 1-7 顆星星動畫
function playStarAnimation(totalWordStars, totalSentenceStars) {
    const modalStars = document.querySelectorAll('.m-star');
    const starAudioPath = '/static/audio/star.mp3';
    
    // 重置所有 Modal 星星類別
    modalStars.forEach(s => s.classList.remove('active-word', 'active-sentence'));

    // 播放前三顆 (單字) - 亮黃色
    for (let i = 0; i < totalWordStars; i++) {
        setTimeout(() => {
            if (modalStars[i]) {
                modalStars[i].classList.add('active-word');
                new Audio(starAudioPath).play().catch(e => {}); 
            }
        }, i * 400);
    }

    // 播放後四顆 (造句) - 亮橘色
    for (let j = 0; j < totalSentenceStars; j++) {
        setTimeout(() => {
            const starIndex = j + 3; // 從第四顆開始
            if (modalStars[starIndex]) {
                modalStars[starIndex].classList.add('active-sentence');
                new Audio(starAudioPath).play().catch(e => {}); 
            }
        }, (j + totalWordStars) * 400); // 接在單字星之後播放
    }
}

// 統一處理困難模式的星星紀錄與關卡解鎖
function handleFinalSave() {
    const mode = 'hard'; // 確保這裡是 hard
    const currentWordStars = document.querySelectorAll('.word-star.active').length;
    const currentSentenceStars = document.querySelectorAll('.sentence-star.active').length;
    const totalStars = currentWordStars + currentSentenceStars;

    // A. 紀錄最高星數
    let starRecords = JSON.parse(localStorage.getItem('starRecords')) || { "easy": {}, "hard": {} };
    if (!starRecords[mode]) starRecords[mode] = {};
    const prevStars = starRecords[mode][currentLevel] || 0;
    if (totalStars > prevStars) {
        starRecords[mode][currentLevel] = totalStars;
        localStorage.setItem('starRecords', JSON.stringify(starRecords));
    }

    // B. 解鎖進度
    let progressData = JSON.parse(localStorage.getItem('gameProgress')) || { "easy": 1, "hard": 1 };
    if (currentLevel >= progressData[mode]) {
        progressData[mode] = currentLevel + 1;
        localStorage.setItem('gameProgress', JSON.stringify(progressData));
    }
}
