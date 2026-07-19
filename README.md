# 媽媽安心記帳 PWA

免費、離線優先的手機網頁App。iPhone以Safari開啟後，可從分享選單加入主畫面；Android可從瀏覽器安裝。

## 已完成

- 手動記帳、分類與本月報表
- 瀏覽器錄音與IndexedDB原始音檔保存
- 月報確認後7天刪除排程與取消
- AES-GCM加密備份檔（含原始音檔）及密碼復原
- 離線快取、PWA manifest與主畫面安裝資訊
- 帳單截圖／CSV選取入口

## 重要限制

- 圖片OCR尚未接入；六家銀行的文字解析規則保留在前一版專案。
- iCloud備份為手動加密檔案，不是自動CloudKit同步。

## 本機預覽

必須透過HTTPS或localhost提供，不能直接雙擊HTML：

```bash
python3 -m http.server 8080
```
