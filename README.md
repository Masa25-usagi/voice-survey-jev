# Voice Survey + Jev

Webアンケートに音声インタビューを組み込む、独立実装のTypeScript共通部品です。会話をGemini Live / OpenAI Realtimeが担当し、TypeSafe Jevが双方の文字起こしから**回答候補**を作ります。確定と次問への移動は本人の操作で行います。

単一選択・複数選択・尺度・自由記述、条件付き設問、既存HTMLフォームへの反映を実装しています。UIは任意のページにマウントでき、ネイティブCustom Elementとしても使えます。元サービスの画面、採点、実データ、APIキー、私的なGit履歴は含みません。

## オフラインで試す

Node.js 22.18以上。

```sh
git clone https://github.com/Masa25-usagi/voice-survey-jev.git
cd voice-survey-jev
npm ci
npm test
npm run demo
```

[ローカルデモ](http://127.0.0.1:4386)を開き、「この質問の発言例」を押してください。架空の図書室ワークショップの台本から候補が出ます。手動で変更して確定すると、下のフォームに回答が入ります。フォームは送信しません。

オフラインデモはマイク・カメラ・外部APIを使わず、ブラウザの永続ストレージにも保存しません。会話分析の共有も架空の送信として表示します。実際のJevの推論ではありません。

## ページに組み込む

ソースから `npm run build` でESMと型定義を生成できます。npmレジストリには公開していません。GitHubからクローンして利用するか、`npm pack` で作ったパッケージをインストールしてください。

```ts
import { defineSurvey, createHttpAnalysis, bindForm } from "voice-survey-jev";
import { mountVoiceSurvey } from "voice-survey-jev/browser";

const survey = defineSurvey({
  id: "workshop", title: "制作ワークショップ",
  questions: [{
    id: "time", type: "single", title: "いつなら参加できそうですか？",
    options: [
      { id: "weekday", label: "平日", meaning: "平日の参加を希望する" },
      { id: "weekend", label: "週末", meaning: "週末の参加を希望する" }
    ]
  }]
});

const widget = mountVoiceSurvey(document.querySelector("#survey")!, {
  survey,
  ...createHttpAnalysis("/api/voice-survey"),
  onComplete: answers => useConfirmedAnswers(answers)
});

const unbind = bindForm(widget.controller, document.querySelector("form")!, {
  time: { name: "participation_time" }
});
// ページの破棄時: unbind(); widget.destroy();
```

音声プロバイダーとサーバーの接続は[組み込みガイド](docs/INTEGRATION.md)にあります。Reactなどの制御されたフォームでは、確定イベントからホストの状態を更新してください。DOMへ書き込む `bindForm` は通常のHTMLフォーム用です。閉じた外部サービスへ勝手にコードを挿入したり、フォームを自動送信したりする機能はありません。

## Jev対応の範囲

| 経路 | 動作 |
| --- | --- |
| 回答候補 | 本人の言葉を根拠とし、聞き手の言葉は文脈だけにする。カメラ・プロフィールは入力しない |
| 8項目分析 | 理解、迷い・条件、判断材料、重視点、説明希望、本人が言葉にした気持ち、具体性、映像への対応 |
| 会話への共有 | 確信度が低い分析はunknownにし、会話の区切りで無音の補助情報を渡す |
| 任意カメラ | 明示同意後の静止画を別の画像モデルで固定項目へ変換。Jevには画像を送らない |
| 任意プロフィール | ホスト定義の項目、本人の言葉による根拠照合、手動訂正・リセット。導入の発言は回答判定へ送らない |
| 自由記述 | Jevで回答の準備状態を判定し、本人の直近の言葉をそのまま候補化。生成要約はしない |

500msの発言確定待ち、直近48発言・各8,000文字・合計12,000文字の循環バッファ、キャンセルと世代番号による遅着拒否を実装しています。分析は最短8秒間隔。映像観察は30秒で失効します。資料、明るさ、鮮明さ、静的な顔の形を扱い、感情・痛み・人格・本人の回答を画像から診断しません。

AI候補と確定回答は別です。手動変更を自動推定で上書きしません。知識不足や回答辞退を中立値に変換しません。確信度は正解率ではありません。

## API接続とデータ

長期キーは利用者のサーバー環境変数で設定します。[.env.example](.env.example)は空の設定例です。ブラウザにはGeminiの制約付き短期トークン、またはOpenAIの接続用SDPだけを返します。モデルはホストの許可リストから選びます。

```sh
# 自分のサーバー環境にキーと利用可能なモデルを設定した後
VOICE_SURVEY_LIVE=1 npm run demo
```

このサーバー例はループバックだけで動く開発用です。外部公開の際は、組み込み先の本人認証・認可・予算制御を `createSurveyHandler` に渡してください。Origin検査だけは本人認証にはなりません。キー設定がなくても、手動回答は利用できます。

会話・映像はメモリ内だけで扱い、停止・設問切替・画面離脱で破棄します。任意のプロフィールは設問をまたいで保持し、本人のリセットまたはウィジェットの破棄で消去します。確定回答の保存先はホストが管理します。AI提供元へ送ったデータの保持条件は別であり、このライブラリがZDRを保証するものではありません。詳細は[データ境界](docs/PRIVACY.md)を確認してください。

## 検証と出自

状態遷移、Jev契約、遅延・キャンセル、メディアの解放、無音共有、サーバー境界の自動テスト98件が通っています。ブラウザでは架空デモの提案→手動訂正→確定→フォーム反映を確認しています。実人の日本語分類精度、実マイク、iPhone実機、各社の有料API接続、表情の読み取り精度は今回の検証に含めていません。[実装範囲](docs/FEATURES.md)・[検証記録](docs/VERIFICATION.md)

元のJev対応試作の機能仕様を参照した独立した書き直しです。許諾未確認の元コード、AudioWorklet、テスト、素材は配布していません。[PROVENANCE.md](PROVENANCE.md)

独立実装はMIT、依存ライブラリは各ライセンスに従います。[第三者ライセンス](THIRD_PARTY.md)
