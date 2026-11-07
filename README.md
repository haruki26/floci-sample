# Floci 画像ギャラリー

Hono on AWS LambdaとS3による、ローカル環境専用の画像アップロードサービスです。画面はHono JSXで描画し、S3・IAM・Lambda・API GatewayをTerraformで管理します。

## 必要な環境

- Docker EngineとDocker Compose
- Node.js 22以降とnpm
- curl

Terraform CLIのインストールや実AWSの認証情報は不要です。TerraformはCompose経由で実行します。

## 起動

```sh
sh scripts/deploy.sh
```

依存のインストール、ビルド、Flociの起動、Terraformの適用を行います。最後に出力されるURLをブラウザーで開き、画像を選択してアップロードしてください。

対応形式はJPEG・PNG・GIF・WebP、上限は1ファイル4 MiBです。画像は非公開S3バケットへ保存し、Lambdaを経由して表示します。元のファイル名ではなく生成したIDで保存・表示します。一覧は60件ずつ表示します。

コードを変更した場合も同じ起動コマンドで再ビルド・再適用できます。

## 検証

```sh
npm run typecheck
npm test
docker compose --profile tools run --rm terraform validate
docker compose --profile tools run --rm terraform plan
```

起動済みのサービスに対する疎通確認は、起動時に出力されたURLを指定して実行します。

```sh
node scripts/smoke.mjs 'http://127.0.0.1:4566/restapis/<API-ID>/local/_user_request_/'
```

この確認ではPNG画像を1枚アップロードし、一覧への反映と取得内容のバイト一致、不正なアップロードの拒否を確認します。検証画像は保存されたまま残ります。

## 停止と削除

```sh
docker compose stop floci
```

Flociのデータは名前付きボリューム、Terraformの状態は`infra/terraform.tfstate`に保存されます。再開は`docker compose up -d floci`です。データボリュームとTerraformの状態ファイルは対応しているため、片方だけを削除しないでください。

リソースを削除する場合はFlociを起動した状態で、バケット内の画像を先に削除してから以下を実行します。画像が残っているバケットの削除は失敗します。

```sh
docker compose --profile tools run --rm terraform destroy
docker compose down
```

## 注意

認証なしの検証用です。外部に公開しないでください。Flociのポート4566はホストのループバックにのみバインドしています。Lambdaコンテナーを起動するため、FlociへDockerソケットを渡しています。信頼できるローカル環境のみで実行してください。

本構成はFloci専用です。実AWSへのデプロイ・本番向け認証・画像の完全なデコード検証は対象外です。アップロード時は形式のシグネチャと申告MIMEタイプを照合します。
