import { Hono } from 'hono'
import { marked } from 'marked'
import { basicAuth } from 'hono/basic-auth'

const app = new Hono<{ Bindings: { DB: D1Database; BUCKET: R2Bucket; ADMIN_USERNAME?: string; ADMIN_PASSWORD?: string } }>()

// 朴素极简 CSS 样式
const layout = (title: string, content: string, showNav: boolean = true) => `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github.min.css" media="(prefers-color-scheme: light)">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github-dark.min.css" media="(prefers-color-scheme: dark)">
  <style>
    :root { --bg: #fdfcfb; --text: #333333; --border: #e2e2e2; --link: #496a81; }
    @media (prefers-color-scheme: dark) {
      :root { --bg: #1a1a1a; --text: #d4d4d4; --border: #333333; --link: #8ab4f8; }
    }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background: var(--bg); color: var(--text); line-height: 1.7; margin: 0; padding: 0; }
    .container { max-width: 650px; margin: 0 auto; padding: 40px 20px; }
    a { color: var(--link); text-decoration: none; transition: color 0.2s; }
    a:hover { color: #283d4e; text-decoration: underline; }
    nav { border-bottom: 1px solid var(--border); padding-bottom: 15px; margin-bottom: 35px; display: flex; justify-content: space-between; align-items: baseline; }
    nav a { font-weight: 500; font-size: 1.05rem; margin-right: 15px; }
    article { margin-bottom: 35px; padding-bottom: 30px; border-bottom: 1px dashed var(--border); }
    article:last-of-type { border-bottom: none; }
    h2 { margin: 0 0 20px 0; font-size: 1.6rem; font-weight: 600; }
    article h3 { margin: 0 0 6px 0; font-size: 1.3rem; font-weight: 600; line-height: 1.4; }
    article small { color: #888; font-size: 0.9em; }
    hr { border: 0; border-top: 1px solid var(--border); margin: 30px 0; }
    .markdown-body { line-height: 1.7; word-wrap: break-word; }
    .markdown-body img { max-width: 100%; box-sizing: content-box; background-color: var(--bg); border-radius: 6px; }
    .markdown-body blockquote { padding: 0 1em; color: #6a737d; border-left: .25em solid #dfe2e5; margin: 0 0 16px 0; font-style: italic; }
    .markdown-body p, .markdown-body blockquote, .markdown-body ul, .markdown-body ol, .markdown-body dl, .markdown-body table, .markdown-body pre, .markdown-body details { margin-top: 0; margin-bottom: 16px; }
    .markdown-body code { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; font-size: 85%; margin: 0; background-color: rgba(128,128,128,0.1); border-radius: 6px; padding: .2em .4em; }
    .markdown-body pre { font-size: 85%; line-height: 1.45; overflow: auto; border-radius: 6px; padding: 16px; border: 1px solid var(--border); }
    .markdown-body pre code { font-size: 100%; background: transparent; padding: 0; margin: 0; border: 0; word-break: normal; white-space: pre; }
    @media (prefers-color-scheme: dark) {
      .markdown-body blockquote { border-left-color: #4b535d; color: #8b949e; }
      .markdown-body code { background-color: rgba(240,246,252,0.15); }
    }
    input[type="text"], input[type="file"], textarea { width: 100%; padding: 12px; margin-bottom: 15px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-family: inherit; font-size: 1rem; border-radius: 6px; transition: border-color 0.2s; }
    input[type="text"]:focus, textarea:focus { outline: none; border-color: #aaa; }
    button { background: var(--bg); color: var(--text); border: 1px solid var(--border); padding: 10px 20px; font-size: 1rem; cursor: pointer; border-radius: 6px; transition: all 0.2s; }
    button:hover { background: rgba(0,0,0,0.03); border-color: #999; }
    .upload-box { border: 1px dashed #ccc; padding: 25px 20px; text-align: center; margin-bottom: 20px; border-radius: 8px; background: rgba(0,0,0,0.01); }
    .pagination { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border); padding-top: 20px; margin-top: 40px; }
    label { display: block; margin-bottom: 5px; font-weight: 500; color: #555; }
  </style>
</head>
<body>
  <div class="container">
    ${showNav ? `
    <nav>
      <div><a href="/">首页</a></div>
      <div><a href="/publish">发布文章</a></div>
    </nav>
    ` : ''}
    <main>
      ${content}
    </main>
  </div>
  <script src="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/highlight.min.js"></script>
  <script>hljs.highlightAll();</script>
</body>
</html>
`

// 1. 首页：查看文章列表（支持分页）
app.get('/', async (c) => {
  const pageStr = c.req.query('page') || '1'
  const page = parseInt(pageStr, 10) > 0 ? parseInt(pageStr, 10) : 1
  const pageSize = 5
  const offset = (page - 1) * pageSize

  // 查询总数
  const totalRes: any = await c.env.DB.prepare('SELECT COUNT(*) as total FROM posts').first()
  const total = totalRes ? totalRes.total : 0
  const totalPages = Math.ceil(total / pageSize)

  // 分页查询数据
  const { results } = await c.env.DB.prepare('SELECT * FROM posts ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .bind(pageSize, offset)
    .all()

  const listHtml = results.length > 0
    ? results.map(p => `
        <article>
          <h3><a href="/post/${p.id}">${p.title}</a></h3>
          <small>发布于: ${p.created_at}</small>
        </article>`).join('')
    : '<p>暂无内容</p>'

  // 分页控件
  let paginationHtml = ''
  if (totalPages > 1) {
    paginationHtml += '<div class="pagination">'
    if (page > 1) {
      paginationHtml += `<a href="/?page=${page - 1}"><button>上一页</button></a>`
    } else {
      paginationHtml += `<span></span>`
    }
    paginationHtml += `<span>第 ${page} / ${totalPages} 页</span>`
    if (page < totalPages) {
      paginationHtml += `<a href="/?page=${page + 1}"><button>下一页</button></a>`
    } else {
      paginationHtml += `<span></span>`
    }
    paginationHtml += '</div>'
  }

  return c.html(layout('我的博客', `<h2>轨迹</h2>${listHtml}${paginationHtml}`, false))
})

// === 权限验证中间件 ===
const authMiddleware = async (c: any, next: any) => {
  const username = c.env.ADMIN_USERNAME || 'admin'
  const password = c.env.ADMIN_PASSWORD || 'password'
  const auth = basicAuth({ username, password })
  return auth(c, next)
}

app.use('/publish', authMiddleware)
app.use('/upload', authMiddleware)
app.use('/edit/*', authMiddleware)

// 2. 详情页：解析并展示 Markdown
app.get('/post/:id', async (c) => {
  const id = c.req.param('id')
  const post: any = await c.env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first()

  if (!post) return c.text('文章不存在', 404)

  const htmlContent = await marked.parse(post.content) // Markdown 转 HTML
  const editLink = `<div style="margin-bottom: 20px; font-size: 0.9em;"><a href="/edit/${post.id}" style="color: var(--text-muted); text-decoration: none;">[✎ 编辑文章]</a></div>`
  return c.html(layout(post.title, `<article class="markdown-body">${editLink}<h2>${post.title}</h2>${htmlContent}</article>`))
})

const editorScript = `
    <script>
      const compressImage = (file, mimeType = 'image/webp', quality = 0.8) => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
              const MAX_WIDTH = 1920;
              const MAX_HEIGHT = 1920;
              let width = img.width;
              let height = img.height;
              if (width > height) {
                if (width > MAX_WIDTH) { height = Math.round(height * (MAX_WIDTH / width)); width = MAX_WIDTH; }
              } else {
                if (height > MAX_HEIGHT) { width = Math.round(width * (MAX_HEIGHT / height)); height = MAX_HEIGHT; }
              }
              const canvas = document.createElement('canvas');
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0, width, height);
              canvas.toBlob((blob) => {
                if (!blob) return reject(new Error('压缩失败'));
                const newName = file.name.replace(/\\\\.[^/.]+$/, "") + '.webp';
                const newFile = new File([blob], newName, { type: mimeType });
                resolve(newFile);
              }, mimeType, quality);
            };
            img.onerror = reject;
          };
          reader.onerror = reject;
        });
      };

      document.getElementById('imageUpload').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const statusLabel = document.getElementById('uploadStatus');
        statusLabel.textContent = '压缩并上传中...';
        statusLabel.style.color = '#0070f3';
        
        let fileToUpload = file;
        try {
          if (['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            fileToUpload = await compressImage(file, 'image/webp', 0.85);
          }
        } catch (err) {
          console.warn('压缩文件回落到原图上传', err);
        }
        
        const formData = new FormData();
        formData.append('image', fileToUpload, fileToUpload.name);
        
        try {
          const res = await fetch('/upload', { method: 'POST', body: formData });
          if (!res.ok) throw new Error('上传失败');
          const data = await res.json();
          
          const textarea = document.getElementById('contentArea');
          const markdownImg = '\\\\n![图片](' + data.url + ')\\\\n';
          
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          textarea.value = textarea.value.substring(0, start) + markdownImg + textarea.value.substring(end);
          textarea.selectionStart = textarea.selectionEnd = start + markdownImg.length;
          textarea.focus();
          
          statusLabel.textContent = '图片上传成功！';
          statusLabel.style.color = 'green';
          e.target.value = ''; // 清空选择以便下次选择同一文件
        } catch (err) {
          console.error(err);
          statusLabel.textContent = '上传失败，请重试';
          statusLabel.style.color = 'red';
        }
      });
    </script>
`;

// 3. 发布页：表单界面
app.get('/publish', (c) => {
  return c.html(layout('发布文章', `
    <h1>发布新文章</h1>
    <div class="upload-box">
      <label>插入配图</label>
      <input type="file" id="imageUpload" accept="image/*">
      <small id="uploadStatus">选择本地图片，自动上传并插入 Markdown</small>
    </div>
    <form method="POST" action="/publish">
      <label>文章标题</label>
      <input type="text" name="title" placeholder="标题..." required>
      <label>文章内容</label>
      <textarea id="contentArea" name="content" placeholder="支持 Markdown..." rows="15" required></textarea>
      <button type="submit">立即发布</button>
    </form>
    ${editorScript}
  `))
})

// 7. 编辑页：表单界面
app.get('/edit/:id', async (c) => {
  const id = c.req.param('id')
  const post: any = await c.env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first()
  if (!post) return c.text('文章不存在', 404)

  return c.html(layout('编辑文章', `
    <h1>编辑文章</h1>
    <div class="upload-box">
      <label>插入配图</label>
      <input type="file" id="imageUpload" accept="image/*">
      <small id="uploadStatus">选择本地图片，自动上传并插入 Markdown</small>
    </div>
    <form method="POST" action="/edit/${post.id}">
      <label>文章标题</label>
      <input type="text" name="title" value="${post.title.replace(/"/g, '&quot;')}" placeholder="标题..." required>
      <label>文章内容</label>
      <textarea id="contentArea" name="content" placeholder="支持 Markdown..." rows="15" required>${post.content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
      <button type="submit">保存修改</button>
    </form>
    ${editorScript}
  `))
})

// 8. 处理编辑：更新 D1 数据库
app.post('/edit/:id', async (c) => {
  const id = c.req.param('id')
  const { title, content } = await c.req.parseBody()

  if (title && content) {
    await c.env.DB.prepare('UPDATE posts SET title = ?, content = ? WHERE id = ?')
      .bind(title, content, id)
      .run()
  }
  return c.redirect('/post/' + id)
})

// 4. 处理发布：写入 D1 数据库
app.post('/publish', async (c) => {
  const { title, content } = await c.req.parseBody()

  if (title && content) {
    await c.env.DB.prepare('INSERT INTO posts (title, content) VALUES (?, ?)')
      .bind(title, content)
      .run()
  }
  return c.redirect('/')
})

// 5. R2 图片上传：接收图片并存入 Bucket
app.post('/upload', async (c) => {
  const body = await c.req.parseBody()
  const image = body['image']
  if (!(image instanceof File)) {
    return c.json({ error: '无效的文件格式' }, 400)
  }

  const extMatch = image.name.match(/\.[^.]+$/)
  const ext = extMatch ? extMatch[0] : ''
  const filename = crypto.randomUUID() + ext

  await c.env.BUCKET.put(filename, await image.arrayBuffer(), {
    httpMetadata: { contentType: image.type },
  })

  return c.json({ url: `/img/${filename}` })
})

// 6. R2 图片获取：从 Bucket 读取图片内容
app.get('/img/:name', async (c) => {
  const name = c.req.param('name')
  const object = await c.env.BUCKET.get(name)
  if (!object) return c.text('Not Found', 404)

  // 设置缓存头
  c.header('Cache-Control', 'public, max-age=31536000')
  c.header('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream')
  return c.body(object.body as any)
})

export default app