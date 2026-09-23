# CI以外の追加通知

Issue: #35

`pull_request`と`issues`の`opened`だけを対象に、作成者のGitHub user typeが`Bot`であるものを通知する。Dependabot PRとGitHub Actions等によるセキュリティissueを含む。通常の人間の作成・コメント・review request・更新・再openを追加通知しない。Botの名前や本文のキーワードだけでは判定しない。

## opt-inと有効化

`NOTIFY_GITHUB_LOGIN`に受信者のGitHub loginを1つ指定したときだけ有効になる。未設定・空・不正なloginでは何も送信しない。既存の署名検証・`ALLOWED_OWNER`・アーカイブ除外は追加通知にも先に適用する。

有効化は別途人間が承認して行う。

1. Draft PRのCIと差分をレビューする。既存のmain向けDeploy workflowがあるため、マージは配備の影響を伴う。PR作成を本番配備済みと解釈しない。
2. 非アーカイブの対象repositoryだけを選び、既存Webhookの購読eventに`pull_request`と`issues`を追加する。`workflow_run`など既存の購読は消さない。
3. Workerの設定へ受信者loginを追加し、`ALLOWED_OWNER`と既存Discord送信先を確認する。Webhook secretやDiscord URLをissue/ログへ貼らない。
4. 専用の検証用Botイベントで通常送信、無効化、対象外owner、署名不正、割当/mentionによる除外、失敗後の手動redeliveryを確認する。

この変更は外部Webhook設定、KV binding、Secret、Deploy workflowを変更しない。既存のWebhook同期処理も変更せず、同期で新規作成するhookは従来の`workflow_run`のみである。既存の一致hookはそのまま扱うため、追加eventはoperatorが明示的に管理する。アーカイブ済みrepositoryを変更しない。

## 通常通知との重複を抑える境界

受信者自身が作成者・assignee・requested reviewerの場合、およびタイトル/本文に受信者へのmentionがある場合は抑止する。チームの所属をpayloadから確認できないため、team review requestやteam mentionがあれば保守的に抑止する。受信者フィールドが欠損・不正な場合も、重複がないと推測して送信しない。

ただしWebhookだけでは個人のWatch、購読状態、通知設定を取得できない。GitHub標準inboxとの完全な重複排除ではない。Watch購読による重複を許容しないrepositoryでは、この追加通知を有効化しない。チーム全体の保守的な除外には、受信者が所属しないチームへの通知まで抑止する制限がある。

## 送信と失敗

追加通知は固定文とタイトル・repository/番号・作者・GitHubリンクだけをDiscordへ送る。本文やCIログをAIへ渡さず、Anthropic APIは呼ばない。`allowed_mentions.parse`を空にしてDiscord上のpingを禁止する。リンクは検証したrepositoryと番号から作り、payloadの任意URLを転送しない。

Discordの`wait=true`によるHTTP成功を確認した後だけ、既存KVの独立prefix`automation:v1:`へ30日間の送信済み記録を保存する。秘密や本文は保存しない。送信timeoutは8秒、失敗時は汎用エラーとHTTP 502を返し、送信済みにはしない。原因解消後はGitHubのRecent deliveriesから必要なeventだけを手動redeliveryする。自動再送が必ず行われるとは仮定しない。

KVの整合性は即時・原子的ではない。同時到着、Discord成功後のKV保存失敗、TTL経過後の再送では重複し得るため、exactly-onceとは扱わない。失敗を隠して成功扱いするよりも、失敗を観測できることを優先する。

無効化は`NOTIFY_GITHUB_LOGIN`を外す。既存CI通知には影響しない。KV全消去やSecret削除は不要。外部購読eventを戻す場合も、この機能で追加したeventだけを削り、他用途の購読を残す。

## 検証

`test/automation-notifications.spec.ts`は選択・除外・transport failure・dedupを検査し、`test/automation-webhook.spec.ts`は実HMAC署名のrequestをWorker entrypointへ渡して既存guardと送信経路を検査する。外部fetchはstubし、実サービスへ送信しない。

既存のWorkersテスト・CLIテスト・TypeScript検査をCIで実施する。別のNode harnessでの成功はWorkers/Vitest上の成功や実際の購読・配備確認の代用にはしない。
