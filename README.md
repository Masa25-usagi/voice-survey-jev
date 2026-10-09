# Voice Survey — Jev特徴スコア版

既存の公開版を残したまま作る、実験用の別バージョンです。ブランチは `experimental/jev-features`、パッケージ名は `voice-survey-jev-features`。公開中の `main` と元のサービスは変更していません。

**LLMが測定項目を設計 → Jevが各特徴の数値だけを抽出 → 正解付きデータから重みを学習 → 重み付きの計算で候補を作る**、という流れに変えています。新しい経路ではJevに回答の選択、最終クラス、会話上の対応を決めさせません。

## 試す

Node.js 22.18以上。

```sh
git clone --branch experimental/jev-features https://github.com/Masa25-usagi/voice-survey-jev.git voice-survey-jev-features
cd voice-survey-jev-features
npm ci
npm test
npm run demo
```

[別版のローカルデモ](http://127.0.0.1:4387)で「この質問の発言例」を押すと、回答候補と特徴の表が出ます。「特徴と学習した重みを見る」で、各スコア、正負の重み、候補への寄与を確認できます。重みを学習し直し、調整データで比較し、最後にテストを開くこともできます。

デモの測定項目はCodexがタスクから設計したものです。Jev出力は台本から作る架空の数値で代用し、**重みの学習は実際のロジスティック回帰**を行います。表示する一致率は計算の動作確認用で、実Jevや未知の日本語会話の精度ではありません。引用された52%・87.61%の再現実験はしていません。マイク・カメラ・外部API・永続ストレージは使いません。

## 特徴スコア版

| 処理 | 内容 |
| --- | --- |
| 次元を設計 | 可変1〜64次元。LLMが具体的な特徴と2〜10段階の基準を提案。学習例だけを見せる |
| 定義を固定 | 定義、順序、基準、Jevの固定バージョンを重みと結び付ける。変更した定義に古い重みを使わない |
| Jevで抽出 | `score`型だけを使う。期待値を0〜1へ正規化し、分布の幅・確信度も記録する |
| 重みを学習 | 学習データだけで標準化・重みを計算。正則化と見送りのしきい値は調整データで選ぶ |
| 最後に評価 | 最終テストは重みの選択後に別の処理で開く。同じ入力の重複やグループをまたぐ分割を拒否する |
| 候補を確認 | 単一選択、複数選択、尺度、自由記述。手動訂正と本人の確定を維持する |

学習器はブラウザでも使える、独立実装のL2正則化付き多クラスロジスティック回帰です。特徴を標準化した値と重みの積を足し、バイアスを加え、softmaxで候補スコアを作ります。候補スコアは実測した正解率ではありません。線形な特徴の組合せで解ける範囲を先に試す実験版です。

8項目の会話分析、発言の訂正・キャンセル、音声の導入・任意プロフィール・静止画の同意、メディア解放、確定回答だけを既存フォームへ反映する処理は既存のMIT公開版から引き継いでいます。回答の抽出には映像・プロフィールを渡しません。会話分析も言葉と固定した映像観察を別々のJev要求へ分け、重みに制約をかけます。言葉の分析にカメラの特徴は使えません。

## 自分のデータで学習する

[JSONL形式・LLM設計・抽出・学習・評価の手順](docs/FEATURES.md)を用意しました。CLIの `design`、`extract`、`train`、`evaluate`、`bundle` を使えます。ライブラリの学習器はアンケート以外の分類にも使えます。

```ts
import { createFeatureSurveyHandler } from "voice-survey-jev-features/server/features";
import { createHttpFeatureAnalysis } from "voice-survey-jev-features/features";
import { mountVoiceSurvey } from "voice-survey-jev-features/browser";

const handle = createFeatureSurveyHandler({
  survey,
  bundle: yourLocallyTrainedBundle,
  allowedOrigins: [yourSurveyOrigin],
  authorize: request => yourSurveyAuthorization(request),
  consumeBudget: request => yourSessionBudget(request),
  typesafeApiKey: process.env.TYPESAFE_API_KEY
});
const widget = mountVoiceSurvey(container, {
  survey, ...createHttpFeatureAnalysis(),
  candidateLabel: "重み付きモデルの候補（未確定）", scoreLabel: "候補スコア",
  onComplete: confirmed => saveThroughYourOwnForm(confirmed)
});
```

ライブのデモには、自分のAPIキーと、**実Jevの特徴で学習した全設問・会話分析のモデル**が必要です。デモの架空の重みを実Jevへ接続するとエラーになります。`FEATURE_BUNDLE` にそのJSONファイルを指定して `VOICE_SURVEY_LIVE=1 npm run demo` を実行します。音声を使う場合は自分の音声モデルも設定してください。[組み込み・音声のガイド](docs/INTEGRATION.md)

ライブ接続や外部データの自動取得は行いません。実データを用意して、その利用条件と正解ラベルを確認するところから実測を始めてください。自分の入力・ラベル・特徴キャッシュは公開リポジトリへ入れず、鍵も自分のサーバーだけに置きます。[データ境界](docs/PRIVACY.md)

## 検証・出自

既存コアのテストに加え、特徴だけのAPI要求、スコア分布、LLMへ渡す学習例の範囲、学習・テストの分離、重みの寄与、見送り、4種類の回答、映像との分離、遅着と手動保護を検証しています。[検証記録](docs/VERIFICATION.md)・[引き継いだ機能](docs/CORE-FEATURES.md)

MITで公開した独立実装 `8cb97b984225da2210ce325552e9c53f2d2c5ba6` を再利用しました。許諾未確認の元サービスのコード、実データ、録音、画像、秘密の設定は追加していません。[PROVENANCE.md](PROVENANCE.md)・[第三者ライセンス](THIRD_PARTY.md)

API契約は公式の[TypeSafe API](https://docs.typesafe.ai/api)、[モデルの説明](https://docs.typesafe.ai/models)、[複数スコアの組合せ](https://docs.typesafe.ai/patterns/composite-scoring)を参照しました。公式cookbookのコードやデータはコピーしていません。
