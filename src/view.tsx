import { raw } from 'hono/html'
import styles from './gallery.css'

export interface ImageItem {
  key: string
  url: string
  name: string
  size: number
  uploadedAt: string
}

interface GalleryPageProps {
  images: ImageItem[]
  basePath?: string
  nextPage?: string
  error?: string
  uploaded?: boolean
}

export function GalleryPage({ images, basePath = '', nextPage, error, uploaded }: GalleryPageProps) {
  return (
    <>
      {raw('<!doctype html>')}
      <html lang="ja">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="color-scheme" content="light" />
          <title>画像の保管庫 | Floci</title>
          <style>{styles}</style>
        </head>
        <body>
          <a class="skip" href="#main">本文へ移動</a>
          <div class="shell">
            <header class="header">
              <div class="brand">
                <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
                  <rect x="3" y="3" width="21" height="21" rx="3" stroke="currentColor" stroke-width="1.5" />
                  <rect x="9" y="9" width="20" height="20" rx="3" fill="currentColor" />
                  <path d="m13 23 4-5 3 3 3-4 3 6H13Z" fill="white" />
                  <circle cx="16" cy="15" r="1.5" fill="white" />
                </svg>
                <span>Floci / 画像の保管庫</span>
              </div>
              <span class="local">ローカル環境</span>
            </header>

            <main id="main">
              <div class="intro">
                <p class="eyebrow">IMAGE STORAGE</p>
                <h1>画像を、ひとところに。</h1>
                <p>アップロードした画像を、この場所で確認できます。</p>
              </div>

              {error && (
                <div class="notice notice-error" role="alert">
                  <strong>処理を完了できませんでした</strong>
                  <p>{error}</p>
                </div>
              )}
              {uploaded && (
                <div class="notice notice-success" role="status">
                  <p>画像をアップロードしました。</p>
                </div>
              )}

              <div class="workspace">
                <section class="upload" aria-labelledby="upload-heading">
                  <h2 id="upload-heading">画像を追加</h2>
                  <p class="upload-description">画像を1枚選んで、アップロードしてください。</p>
                  <form action={`${basePath}/images`} method="post" enctype="multipart/form-data">
                    <label class="file-label" for="image">画像ファイル</label>
                    <input class="file-input" id="image" name="image" type="file" accept="image/png,image/jpeg,image/gif,image/webp" required aria-describedby="file-help" />
                    <p class="file-help" id="file-help">JPEG・PNG・GIF・WebP<br />1枚あたり最大 4 MiB（4,194,304 バイト）</p>
                    <button class="submit" type="submit">アップロード <span aria-hidden="true">↑</span></button>
                  </form>
                  <p class="upload-note">保存先はローカルの Floci S3 です。</p>
                </section>

                <section class="collection" aria-labelledby="gallery-heading">
                  <div class="collection-header">
                    <h2 id="gallery-heading">保存した画像</h2>
                    <span class="count">このページ <b>{images.length}</b> 枚</span>
                  </div>
                  {images.length > 0 ? (
                    <ul class="gallery">
                      {images.map((image) => {
                        const date = new Date(image.uploadedAt)
                        const validDate = !Number.isNaN(date.getTime())
                        const size = image.size < 1024
                          ? `${image.size} B`
                          : image.size < 1024 * 1024
                            ? `${(image.size / 1024).toLocaleString('ja-JP', { maximumFractionDigits: 1 })} KiB`
                            : `${(image.size / (1024 * 1024)).toLocaleString('ja-JP', { maximumFractionDigits: 1 })} MiB`
                        return (
                          <li class="image-card" key={image.key}>
                            <a class="image-link" href={image.url} aria-label={`${image.name} を開く`}>
                              <div class="image-stage">
                                <img src={image.url} alt={image.name} loading="lazy" decoding="async" />
                              </div>
                              <div class="image-caption">
                                <span class="image-name">{image.name}</span>
                                <span class="open">開く <span aria-hidden="true">↗</span></span>
                              </div>
                            </a>
                            <p class="image-meta">
                              <span>{size}</span>
                              {validDate && <time datetime={date.toISOString()}>保存日 {date.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' })}</time>}
                            </p>
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <div class="empty">
                      <svg viewBox="0 0 56 56" fill="none" aria-hidden="true">
                        <rect x="8" y="7" width="34" height="34" rx="4" stroke="currentColor" stroke-width="1.5" />
                        <rect x="15" y="15" width="34" height="34" rx="4" fill="#eff3f8" stroke="currentColor" stroke-width="1.5" />
                        <path d="m21 40 7-9 5 5 5-7 5 11H21Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
                        <circle cx="25" cy="25" r="2.5" stroke="currentColor" stroke-width="1.5" />
                      </svg>
                      <h3>まだ画像はありません</h3>
                      <p>最初の1枚をアップロードすると、<br />ここに画像が並びます。</p>
                      <a href="#image">画像ファイルを選ぶ</a>
                    </div>
                  )}
                  {nextPage && <nav class="pagination" aria-label="画像一覧のページ"><a href={nextPage}>次のページ <span aria-hidden="true">→</span></a></nav>}
                </section>
              </div>
            </main>

            <footer class="footer">
              <p>Floci · ローカル画像ストレージ</p>
              <p>認証なしの検証用です。外部には公開しないでください。</p>
            </footer>
          </div>
        </body>
      </html>
    </>
  )
}
