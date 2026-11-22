# gma2-form-helper 設計文件

日期：2026-11-22
狀態：草稿，待使用者核可

## 1. 目的與動機

在 grandMA2 的 Graph Editor 裡畫 Effect Form 很不直覺，常常要反覆試錯：調一個點、回去看效果、再調。這個專案要做兩樣東西：

1. **網頁工具**：使用者手繪 Form 曲線，網頁算出 Graph Editor Table Mode 每個點的 X、Y、Mode。使用者照著輸入，或直接匯入，就能在 MA 裡得到同樣的 Form。
2. **grandMA2 plugin**：把網頁產出的檔案匯入成 Form，不用手打 Import 指令。

成功的標準：網頁預覽看到的曲線就是 MA 裡會得到的曲線，不需要再進 MA 試。

## 2. 目標、非目標、反目標

**目標**
- 手繪 → 自動轉成可編輯的點，再用拖曳、改 Mode 精修（「混合式」編輯）。
- 一個 Form 支援多個 graph（SubForm）。
- 預覽依照 MA 的規則畫出來：頭尾循環、Step、Spline。
- 輸出 Table Mode 數值表，方便手動輸入。
- 輸出 MA 可匯入的 XML。
- 讀進 MA 匯出的 Form XML，拿來修改。
- plugin 完成匯入：選檔案、選 Form 格位、確認覆蓋。
- 公開的靜態網站，繁中與英文介面。

**非目標（第一版不做）**
- 模擬 Effect 套到一排燈上的效果（Phase、Width、Speed、Low/High），留到第二版。
- grandMA3 支援。
- 帳號、雲端儲存、分享連結。
- 編輯 Effect 本身，只處理 Form。

**反目標（就算功能都能跑，出現這些也算失敗）**
- 預覽和 MA 實際結果不一致，使用者還是得回 MA 試錯。
- 手繪轉出來的點太多，手動輸入很痛苦。
- 匯出的檔案在 MA 匯入失敗，或悄悄覆蓋掉使用者既有的 Form。
- plugin 或實驗動到使用者正式的 show。

## 3. 已查證的 grandMA2 事實

以下都是 2026-11-22 在 onPC 3.9.60.50 上實際匯出和匯入確認過的。

### 3.1 Form XML 格式

```xml
<?xml version="1.0" encoding="utf-8"?>
<MA xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://schemas.malighting.de/grandma2/xml/MA" xsi:schemaLocation="http://schemas.malighting.de/grandma2/xml/MA http://schemas.malighting.de/grandma2/xml/3.9.60/MA.xsd" major_vers="3" minor_vers="9" stream_vers="60">
	<Info datetime="2026-11-22T20:45:00" showfile="form-helper-lab" />
	<Form index="0" name="FH Modes" display_2d="false">
		<SubForm index="0" name="modes" display_spec_index="0" graph_color="c0c0c0">
			<SubFormPoint index="0" x="0" y="0.2" mode="linear" />
			<SubFormPoint index="1" x="0.15" y="0.8" mode="spline" />
			...
		</SubForm>
		<SubForm index="1" ...>...</SubForm>
	</Form>
</MA>
```

- 結構是 `MA > Form > SubForm（= graph）> SubFormPoint`。
- **XML 裡 `x`、`y` 是 0–1 的浮點數，Table Mode 顯示 0–100**，小數兩位。值是 0 時 MA 匯出會省略該屬性，所以讀檔時屬性不存在要當 0。
- 浮點誤差可能讓 y 出現像 `-8.7422777e-08` 這種值，讀檔時要容忍。
- `mode` 的值（XML 寫法 → Table Mode 顯示）：
  - `linear` → Linear
  - `spline` → Spline
  - `spline_break_start` → Spline (Break at Start)
  - `spline_break_end` → Spline (Break at End)
  - `step_start` → Step (Start)
  - `step_end` → Step (End)
- 點的 `index` 是建立順序，不一定照 X 排序，MA 顯示時會自己排序。讀檔時要依 X 排序（X 相同時保持原本的 index 順序）。
- 同一個 X 可以有兩個點，例如內建的 RAIN STAIR，用來做垂直跳變。也有人用 X 相差 0.001 的兩點做跳變（C.M.Y）。
- SubForm 的屬性有 `name`（可省略）、`display_spec_index`（目前見到的都是 0）、`graph_color`（6 位 hex RGB）。
- Form 的屬性有 `name`、`display_2d`（Circle 這類 Pan/Tilt Form 是 true）。
- 一個檔案可以包含多個 `<Form>`。MA 匯出時，`<Form index>` 是 pool 編號減 1（Form 1 → `index="0"`，Form 102 → `index="101"`）。用 `Import ... At Form N` 時，index 會被忽略，以 N 為準：`index="0"` 的檔案匯入到了 Form 101。網頁寫出時一律用 `index="0"` 起算。
- 只有一個點的 SubForm 是合法的，例如 Flat High，代表水平線。

### 3.2 曲線行為

- **曲線會頭尾循環。** Sin 只有 X=0 到 87.5 共 8 個點，最後一點接回第一點（經過 X=100 回到 X=0）。第一個點的 X 也不一定是 0，例如 Phase 1 從 16.67 開始。
- Mode 決定的是「這個點到下一個點」這一段怎麼走。

### 3.3 匯入與匯出

- 匯出：`Export Form 1 Thru 60 "name" /o`，檔案會寫到 `<版本資料夾>\importexport\name.xml`。
- 匯入：`Import "fh_modes" At Form 101`，輸出 `1 object(s) from "fh_modes.xml" imported.`。手寫的 XML 已經驗證可以匯入，2 個 graph、6 種 Mode 都正確。
- **匯入到已有 Form 的格位時，MA 會跳出 Overwrite Confirmation 對話框**（選項：Overwrite / Overwrite|All / Insert / Insert|All / Cancel），加 `/o` 也一樣。用 `Delete Form N /nc` 可以不經確認刪除。plugin 要考慮這一點。
- 匯入時，同一個 X 的多個點會保持檔案裡的順序。
- 透過 Telnet 可以列出點：`cd Form 101`、`cd 1`、`List`，會顯示 X / Y / Mode 的表格。可以用來在測試中驗證匯入結果。

### 3.4 曲線校正結果

已在 #2 校正完成，規則與誤差見 `docs/ma2-form-modes.md`。重點：Linear、Step 完全精確；Spline 是以「chain」為單位的 C2 三次樣條，接 Linear/Step 時沿用鄰段斜率，Break 是成對使用的 chain 邊界；只有「整條都是 Spline、沒有 Break」的封閉曲線是近似（RMS 0.2–2.7）。

### 3.4.1 原本列為未查證的項目

- **每種 Mode 的精確插值公式**，特別是 Spline、Spline Break 和兩種 Step 的語意（Step Start 是在段落開頭跳變，還是取下一點的值等）。
- 在 X=0 與 X=100 交界處，循環時的插值方式。
- 3.9.60 產生的 XML 能否匯入 3.3.4。

**校正用的參考 Form**：使用者在 `form-helper-lab` 手動建立了 Form 102–106，分別命名為 Spline、Spline (Break at Start)、Spline (Break at End)、Step (Start)、Step (End)。每個都是兩個點 (0,0) → (100,100)，所有點用同一種 Mode。匯出檔是 `fh_user_102_106.xml`。Form 101 `FH Modes` 是 Claude 匯入的混合 Mode 測試。onPC 的 Screen 2 開著 Form pool，graph editor 應該可以從那裡開啟並截圖。

**上線標準（使用者決定）**：Spline 可以先用近似上線，校正和其他功能同時進行。吻合的定義是 0–100 尺度上誤差 ≤ 1。在校正完成之前，預覽上的 Spline 段落要標示「近似」。Linear 和 Step 必須精確。

## 4. 方案

| 方案 | 內容 | 取捨 |
|------|------|------|
| **A. 靜態網頁 + XML + 常駐 plugin（採用）** | 網頁產出、讀取 MA 格式的 XML；plugin 裝一次，負責匯入 | onPC 和實體 console（USB）都能用；XML 匯入已經驗證可行 |
| B. 桌面 App（Electron） | 直接把檔案寫進 onPC 的資料夾 | 實體 console 還是要用 USB；要處理安裝、更新、簽章，換來的好處不多 |
| C. 每個 Form 產生一個 plugin | 網頁把資料包進 Lua plugin，執行後建立 Form | 不用另外裝 plugin，但每個 Form 都要匯入一次 plugin，plugin 池會越塞越亂 |

使用者把實作方式交給 Claude 決定，Claude 選了 A。

## 5. 使用者已經決定的事

1. 編輯方式：**混合式**。先手繪，自動轉成點，再拖曳點、改 Mode 精修。
2. **一開始就支援多個 graph**：分頁切換，對應 MA Table Mode 的分頁。目前編輯的 graph 實線顯示，其他 graph 淡色疊在背景。graph 可以命名、設定顏色。
3. 使用情境**同時包含**同一台電腦的 onPC，以及用 USB 帶到實體 console。共同的做法是下載 XML 檔。
4. 手繪轉點的原則：
   - **預設點少、形狀乾淨**，提供「精細度」滑桿。
   - 自動判斷 Mode：圓滑段落用 Spline，轉角用 Linear 或 Spline Break，水平後跳變用 Step。
   - 數值四捨五入到**小數一位**（0–100 尺度）。
   - **格線吸附**可以開關，預設 X 每 12.5、Y 每 10。
5. **讀進 MA 匯出的 Form XML**：一個檔案有多個 Form 時列出清單挑選。
6. 版本：**以 3.9.60 為主**。網頁匯出時可以選目標版本（改寫標頭）；3.3.4 實測可行才列入支援。
7. plugin **放在這個 repo**，寫法和打包慣例照 `chienchuanw/gma2-plugins`。
8. **公開上線**，部署到 Vercel，介面提供繁中與英文切換，預設依瀏覽器語言。MA 術語（Spline、SubForm、Mode 名稱）一律保留英文。
9. Effect 模擬留到第二版。
10. 實驗只能在 onPC 上專用的 `form-helper-lab` show 進行，不能動使用者正式的 show。
11. Spline 可以先用近似上線（見 3.4 的上線標準）。

## 6. 設計

### 6.1 Repo 結構

```
web/        網頁（React + TypeScript + Vite）
plugin/     grandMA2 plugin（Lua + XML 描述檔）
tools/      開發用的腳本（Telnet 驗證工具等）
docs/       設計、計畫、Form 格式說明
```

### 6.2 核心資料模型（web）

```ts
type Mode = 'linear' | 'spline' | 'spline_break_start' | 'spline_break_end' | 'step_start' | 'step_end';
interface Point { x: number; y: number; mode: Mode }   // 0–1，和 XML 一致
interface Graph { name?: string; color: string; points: Point[] }  // points 依 x 排序
interface Form  { name: string; display2d: boolean; graphs: Graph[] }
```

內部統一用 0–1，和 XML 一致；顯示和表格輸出時換算成 0–100。

**精度規則（Claude 的決定）：**
- 網頁「產生或移動」的點，包括手繪擬合、拖曳、吸附，都四捨五入到 0–100 尺度的一位小數，存進 XML 的就是四捨五入後的值。這樣手動輸入和匯入兩條路會得到同一個 Form。
- 從 XML 讀進來的點保留原始精度，例如 Sin 的 `85.355…`；沒被移動的點寫回時維持原值，這樣來回測試才會一致。
- 表格和 MA 一樣顯示兩位小數。
- 在表格中直接輸入的數值保留 MA 的兩位小數（0–100 尺度），超出 0–100 會被夾回範圍內。

### 6.3 模組

1. **插值引擎 `evaluate(graph, t)`**：依 MA 的規則算出 t ∈ [0,1) 的值，包含循環。預覽、手繪擬合、測試都用同一個引擎。插值公式要先在實驗室校正（見 3.4）；校正完成前先用合理的近似（Spline 用 Catmull-Rom），預覽上標示「Spline 為近似」。
2. **手繪擬合**：輸入手繪軌跡，輸出點和 Mode。流程是：
   1. 重新取樣成單值函數（同一個 X 只有一個 Y；往回畫的部分忽略或夾住）。
   2. 偵測垂直跳變。
   3. 簡化，例如 Ramer–Douglas–Peucker，容差由精細度滑桿控制。
   4. 依曲率和轉角分配 Mode。
   5. 套用吸附和四捨五入。
   6. 用插值引擎重新計算誤差，必要時補點。
3. **編輯器（SVG）**：手繪、拖曳點、新增和刪除點、每段選 Mode、graph 分頁、背景疊圖、格線吸附開關、復原和重做。
4. **表格輸出**：每個 graph 一個表格，欄位是 No. / X / Y / Mode，格式和 MA Table Mode 一樣（0–100、兩位小數顯示、Mode 用 MA 顯示名稱）。可以一鍵複製。
5. **XML 讀寫**：
   - 寫出：照 3.1 的格式，Form 名稱可以自訂，可以選目標版本標頭。檔名預設 `fh_<form名稱>.xml`，只用 ASCII，空白換成底線。
   - 讀入：照 3.1 的規則容錯（屬性省略、浮點誤差、無序的 index、BOM）。
6. **i18n**：繁中和英文。

### 6.4 plugin

- 檔案：`plugin/Form Helper Import/Form Helper Import.lua` 和 `.xml`，照 gma2-plugins 的慣例。
- 流程：
  1. 用 `gma.textinput` 詢問檔名，預設值是上次用的檔名，或找得到的最新一個 `fh_*.xml`。
  2. 詢問目標 Form 編號，預設是第一個空的格位。
  3. 目標格位已經有 Form 時，用 `gma.gui.confirm` 確認是否覆蓋。
  4. 執行 `gma.cmd('Import "..." At Form N')`。
  5. 透過 `gma.echo` 回報結果，失敗時也要用對話框告知。
- 檔案來源要支援硬碟的 importexport 和 USB 的 `gma2/importexport`。
- 只用 3.9.60 確認可用的 API；如果 3.3.4 也要支援，就只用 3.3.4 也有的 API。
- 驗收（Claude 的決定）：硬碟 importexport 這條路在 onPC 3.9.60 的實驗室自動驗證。USB 這條路在 onPC 上無法完整模擬，由使用者之後在實體 console 上實測一次，列為第一版上線前的手動檢查項目。

### 6.5 測試

- web：Vitest 單元測試，涵蓋插值引擎、擬合、XML 讀寫。
- **來回測試**：讀進 MA 匯出的檔案再寫出，點的內容要一致。測試資料用內建 Form 1–23 的匯出檔，以及實驗用的 `fh_modes.xml`。**不要把使用者正式 show 裡的自訂 Form 放進 repo。**
- **onPC 整合驗證**：`tools/` 提供腳本，透過 SSH 上傳 XML、透過 Telnet 匯入，再 `List` 回讀，比對 X / Y / Mode。只能在 `form-helper-lab` show 執行。
- 開發環境：Windows 測試機的連線方式記錄在 Claude 的 memory，不寫進 repo。

## 7. 限制

- grandMA2 只在 Windows（onPC）或 console 上跑，plugin 無法在 Mac 上測試。整合測試要靠 Windows 測試機。
- 對 onPC 執行 `NewShow` 會把 Telnet 重設成關閉（就算加了 `/globalsettings`），需要使用者手動重新開啟。
- Spline 的形狀只能透過截圖比對。透過 Telnet 執行 `Edit Form` 不會在主畫面開啟 graph editor，開啟的方法要再找。

## 8. 留給實作者決定的事

- 擬合演算法的細節和參數。
- 前端的 UI 元件與樣式。
- 復原和重做的實作方式。
- plugin 預設「最新檔案」與「第一個空格位」的偵測方法（可以逐一探測檔名或格位）。
- 插值校正的方法（截圖比對，或其他可行方式）。
