---
name: drawio-release
description: >-
  draw.io Desktop（非公式ビルド / fork）の upstream 更新取り込みから Windows ポータブルビルド生成、
  テスト検証、タグ作成、GitHub Release 公開までの一連のリリース手順を実行するスキル。
  ユーザーが「リリースして」「vXX.X.Xを取り込んでビルドして」「Windowsビルドを作成して」「リリースまで進めて」
  などのリリース作業を指示した際に使用する。
---

# draw.io Desktop リリース手順書 (drawio-release)

このスキルは、`jgraph/drawio-desktop` および `jgraph/drawio` の最新リリースを取り込み、
当リポジトリ独自の改善（図形選択改善、各種プラグイン、レイヤーウィンドウ永続化等）を維持した状態で
Windows ビルド（ポータブル ZIP）を作成し、GitHub Releases に公開するまでの一連の手順を定義します。

---

## 遵守ルール・制約事項

- **`*.exe` 実行禁止**: Linux 環境上での Wine や `.exe` 直接実行は絶対に行わない（electron-builder は `--win --dir` で unpack のみ行う）。
- **`/mnt/*` アクセス禁止**: マウント領域へのアクセスは行わない。
- **事実確認の徹底**: 推測で進めず、各ステップごとに git status やテスト結果、ファイル生成結果を確認する。
- **独立した複雑なタスクはサブエージェント委譲**: upstream のマージやコンフリクト解消は `self` 等のサブエージェントに委譲して検証する。

---

## 前提条件

- `gh` (GitHub CLI) が認証済みであること (`gh auth status`)
- Node.js (>= 22.12.0) および npm が利用可能であること
- `zip` コマンドがインストールされていること
- リポジトリ構成:
  - ルート: `cwatanab/drawio-desktop` (ブランチ: `dev`, remote: `origin`)
  - サブモジュール `drawio`: `cwatanab/drawio` (ブランチ: `selection-improvements`, remote: `fork`, upstream remote: `origin`)

---

## リリース作業ワークフロー

### Step 1: 作業ツリーの確認と未コミット変更の整理

1. `drawio-desktop` および `drawio` サブモジュールの未コミット変更を確認する:
   ```bash
   git status
   git -C drawio status
   ```
2. 未コミットの変更がある場合:
   - 次期リリースに含める改善であれば適切にコミットする。
   - 保留する変更であれば `git stash push -u -m "pre-release"` で退避する。

---

### Step 2: upstream 更新の取り込み (Upstream Sync)

※ マージとコンフリクト解消の工程は、独立タスクとしてサブエージェントへの委譲を推奨。

1. **サブモジュールで upstream タグを取得**:
   ```bash
   git -C drawio fetch origin --tags
   git -C drawio tag -l "v*" --sort=-v:refname | head -n 5
   ```
2. **目的のバージョン（例: `v31.4.x`）をマージ**:
   ```bash
   git -C drawio merge --no-ff <tag_name> -m "Merge tag '<tag_name>' into selection-improvements"
   ```
3. **コンフリクト解消の原則**:
   - ビルド済みファイル (`drawio/src/main/webapp/js/app.min.js`, `viewer.min.js`, `viewer-static.min.js`):
     当リポジトリの独自機能（選択改善・プラグイン・レイヤー対応）を含んでいるため、`git checkout --ours <file>` で当リポジトリ側の実装を維持する。
   - ソースコード (`bootstrap.js`, `diagramly/App.js`, `diagramly/EditorUi.js`, `Graph.js` 等):
     upstream の変更差分と当リポジトリの改善コードが競合していないか確認し、プラグイン読み込み順序やイベント処理が維持されるよう統合する。
4. **バージョン同期と自動更新の無効化**:
   `drawio-desktop` ルートで以下を実行:
   ```bash
   npm run sync -- disableUpdate
   ```
   - `drawio/VERSION` から `package.json` の `version` が同期される。
   - `src/main/disableUpdate.js` が `export function disableUpdate() { return true;}` に更新される。
5. **テスト実行**:
   ```bash
   npm test
   ```
   - すべてのテスト（170+ 件）が通過することを確認する。
6. **コミット**:
   ```bash
   git commit -am "chore: <tag_name> 取り込みおよびバージョン同期"
   ```

---

### Step 3: Windows ポータブルビルドの作成

1. **electron-builder による unpack ディレクトリ生成**:
   ```bash
   DRAWIO_UNSIGNED=true npx electron-builder --config electron-builder-win.json --win --x64 --dir --publish never
   ```
   - `DRAWIO_UNSIGNED=true` により Azure Trusted Signing / signtool.exe がスキップされる。
   - `build/fuses.mjs` により Electron Fuses が設定される。
   - 成果物は `dist/win-unpacked/` に出力される。
2. **`package.json` の差分復元**:
   - electron-builder の実行により作業ツリーの `package.json` から `scripts` / `devDependencies` が削除される場合があるため、即座に復元する:
     ```bash
     git checkout package.json
     ```
3. **内部バージョンの検証**:
   ```bash
   node -e "const asar = require('@electron/asar'); console.log(JSON.parse(asar.extractFile('dist/win-unpacked/resources/app.asar', 'package.json')).version)"
   ```
   - 出力されるバージョンが目的のバージョンと一致することを確認。
4. **ポータブル ZIP パッケージの作成**:
   ```bash
   cd dist
   rm -f draw.io-<version>-windows.zip
   zip -q -r draw.io-<version>-windows.zip win-unpacked
   cd ..
   ```
   - ZIP のルートが `win-unpacked/` となっていることを確認:
     ```bash
     zipinfo -1 dist/draw.io-<version>-windows.zip | head -n 5
     sha256sum dist/draw.io-<version>-windows.zip
     ```

---

### Step 4: リモート Push とタグ作成

1. **`drawio` サブモジュールの Push**:
   ```bash
   git -C drawio push fork selection-improvements
   git -C drawio push fork selection-improvements:ui-improvements
   ```
2. **`drawio-desktop` の Push**:
   ```bash
   git push origin dev
   ```
3. **リリースタグの作成と Push**:
   ```bash
   TAG="v<version>-unofficial"
   git tag -a "$TAG" -m "$TAG"
   git push origin "$TAG"
   ```

---

### Step 5: GitHub Release の作成とアセット添付

1. **Release の作成**:
   ```bash
   TAG="v<version>-unofficial"
   ASSET="dist/draw.io-<version>-windows.zip"
   
   gh release create "$TAG" "$ASSET" \
     --repo cwatanab/drawio-desktop \
     --title "$TAG" \
     --notes "Unofficial Windows x64 portable build based on draw.io Desktop v<version>.
   Unsigned; no installer.
   
   ### 主な変更点
   - **draw.io v<version> の取り込み**:
     公式リポジトリの最新リリース v<version> をマージ・同期。
   - **当リポジトリの改善機能**:
     - コンテナ・グループ内の子要素直接クリック選択
     - 背面図形・枠線の選択改善
     - 階層ホバーハンドル
     - 階層ビューア（hierarchy-viewer）
     - ハンドルスケーラー（handle-scaler）
     - クイックスタイラー（quick-styler）
     - レイヤーウィンドウ表示状態永続化
   
   > [!WARNING]
   > このビルドは個人用・非公式の unsigned ビルドです。OS のセキュリティ警告（SmartScreen 等）が表示される場合があります。"
   ```
2. **公開結果の確認**:
   ```bash
   gh release view "$TAG" --repo cwatanab/drawio-desktop
   ```

---

### Step 6: （オプション）GitHub Actions でのインストーラビルド

Windows インストーラ（`.exe` / `.msi`）が必要な場合は、GitHub Actions のワークフローを手動トリガーする:
```bash
gh workflow run personal-build.yml --repo cwatanab/drawio-desktop --ref dev -f platform=windows
```
ビルド完了後、ワークフローの Artifacts または Release にアセットを追加可能。
