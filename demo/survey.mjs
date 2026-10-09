export const survey = {
  id: "fictional-workshop", title: "架空の図書室ワークショップ", language: "ja",
  questions: [
    { id: "schedule", type: "single", title: "ワークショップに参加するなら、いつがよさそうですか？", explanation: "架空の図書室で、気軽な制作ワークショップを開くという設定です。実際の申込みではありません。", options: [{ id: "weekday", label: "平日の夕方", meaning: "平日の夕方に参加したい" }, { id: "weekend", label: "週末の昼間", meaning: "土日の日中に参加したい" }, { id: "either", label: "どちらでも", meaning: "どちらの時間でも参加できる" }], sources: [{ title: "架空の開催案内", publisher: "デモ用の図書室", text: "平日夕方か週末昼間の、同じ内容のワークショップを想定しています。どちらも架空の予定です。" }] },
    { id: "activities", type: "multiple", title: "やってみたいことを選んでください", maxSelections: 2, options: [{ id: "paper", label: "紙の工作", meaning: "紙を使って何かを作る" }, { id: "stories", label: "短い物語を書く", meaning: "文章を書いて楽しむ" }, { id: "drawing", label: "絵を描く", meaning: "お絵描きを楽しむ" }] },
    { id: "pace", type: "scale", title: "進めるペースは、どのくらいがよさそうですか？", min: 1, max: 5, labels: { "1": "1 · とてもゆっくり", "2": "2 · ゆっくり", "3": "3 · ほどほど", "4": "4 · 少し速く", "5": "5 · 速く" } },
    { id: "idea", type: "text", title: "ほかにやってみたいことはありますか？", maxLength: 500, explanation: "話した言葉をそのまま候補にします。読み直して、画面で直してから確定できます。" }
  ]
};
export const scripts = {
  schedule: { assistant: "平日の夕方と週末の昼間なら、どちらがよさそうですか？", user: "平日は予定があるので、週末の昼間なら参加できそうです。" },
  activities: { assistant: "どんな制作をしてみたいですか？", user: "紙の工作と絵を描くことをやってみたいです。" },
  pace: { assistant: "制作のペースについて希望はありますか？", user: "急がず、5段階なら2くらいの、ゆっくりしたペースがいいです。" },
  idea: { assistant: "ほかに試したいことはありますか？", user: "みんなで一つの架空の街の地図を描いてみたいです。" }
};
