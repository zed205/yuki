$f = 'src/server/browser.ts'
$c = [System.IO.File]::ReadAllText($f)

# 1. getPageContent - wrap textContent('body')
$old = "      const text = await this.page!.textContent('body');"
$new = "      const raw = await this.page!.textContent('body');"
$c = $c.Replace($old, $new)

$old = "      return text?.substring(0, 5000) || content.substring(0, 5000);"
$new = "      const text = normalizeLineEndings(raw || '');`r`n      return text?.substring(0, 5000) || content.substring(0, 5000);"
$c = $c.Replace($old, $new)

# 2. getLinks - wrap el.textContent()
$old = "          const text = await el.textContent();"
$new = "          const raw = await el.textContent();"
$c = $c.Replace($old, $new)

$old = "          return `${text?.trim() || '(no text)'} -> ${href}`;"
$new = "          return `${normalizeLineEndings(text?.trim() || '(no text)')} -> ${href}`;"
$c = $c.Replace($old, $new)

# 3. getVisibleElements - wrap textContent in evaluate
$old = "          const text = (el as HTMLElement).textContent?.trim().slice(0, 200) || '';"
$new = "          const raw = (el as HTMLElement).textContent || '';"
$c = $c.Replace($old, $new)

$old = "            text: text.slice(0, 100),"
$new = "            text: normalizeLineEndings(text).slice(0, 100),"
$c = $c.Replace($old, $new)

# 4. xpath - wrap el.textContent()
$old = "        const text = await el.textContent() || '';"
$new = "        const raw = (await el.textContent()) || '';"
$c = $c.Replace($old, $new)

$old = "        results.push(`#${i}: <${tag}> text=""${text.trim().slice(0, 200)}""`"
$new = "        results.push(`#${i}: <${tag}> text=""${normalizeLineEndings(text).trim().slice(0, 200)}""`"
$c = $c.Replace($old, $new)

# 5. extractContent - wrap textContent calls inside evaluate
$old = "        const title = titleEl?.textContent?.trim() || '';"
$new = "        const title = normalizeLineEndings(titleEl?.textContent || '').trim();"
$c = $c.Replace($old, $new)

$old = "        const author = authorEl?.textContent?.trim().replace('@', '').replace('u/', '') || '';"
$new = "        const author = normalizeLineEndings(authorEl?.textContent || '').trim().replace('@', '').replace('u/', '') || '';"
$c = $c.Replace($old, $new)

$old = "        const body = bodyEl?.textContent?.trim().slice(0, 5000) || element.textContent?.trim().slice(0, 5000);"
$new = "        const rawBody = normalizeLineEndings(bodyEl?.textContent || element.textContent || '');`r`n        const body = rawBody.trim().slice(0, 5000);"
$c = $c.Replace($old, $new)

$old = "            const text = link.textContent?.trim() || '';"
$new = "            const text = normalizeLineEndings(link.textContent || '').trim();"
$c = $c.Replace($old, $new)

# For the author in comments (authorEl2)
$old = "          const author2 = authorEl2?.textContent?.trim().replace('@', '').replace('u/', '') || '';"
$new = "          const author2 = normalizeLineEndings(authorEl2?.textContent || '').trim().replace('@', '').replace('u/', '') || '';"
$c = $c.Replace($old, $new)

# For comment text
$old = "          const text = textEl?.textContent?.trim() || comment.textContent?.trim().slice(0, 1000);"
$new = "          const rawText = normalizeLineEndings(textEl?.textContent || comment.textContent || '');`r`n          const text = rawText.trim().slice(0, 1000);"
$c = $c.Replace($old, $new)

# For score
$old = "          const score = scoreEl?.textContent?.trim() || '';"
$new = "          const score = normalizeLineEndings(scoreEl?.textContent || '').trim();"
$c = $c.Replace($old, $new)

# For replies
$old = "            replies.push(reply.textContent?.trim().slice(0, 500) || '');"
$new = "            replies.push(normalizeLineEndings(reply.textContent || '').trim().slice(0, 500));"
$c = $c.Replace($old, $new)

# 6. getPageStructure - wrap textContent
$old = "          const text = link.textContent?.trim() || '';"
$new = "          const text = normalizeLineEndings(link.textContent || '').trim();"
$c = $c.Replace($old, $new)

$old = "          headings.push(heading.textContent?.trim() || '');"
$new = "          headings.push(normalizeLineEndings(heading.textContent || '').trim());"
$c = $c.Replace($old, $new)

# Also normalize the final JSON results as a safety net
$old = "      return JSON.stringify(result, null, 2).substring(0, 10000);"
$new = "      return normalizeLineEndings(JSON.stringify(result, null, 2)).substring(0, 10000);"
$c = $c.Replace($old, $new)

# Also normalize the result in getPageContent (the text variable is already normalized above)
# But also normalize the raw HTML content
$old = "       const text = await this.page!.content();"
$new = "       const rawContent = await this.page!.content();"
$c = $c.Replace($old, $new)

[System.IO.File]::WriteAllText($f, $c, [System.Text.Encoding]::UTF8)
Write-Host "browser.ts changes applied"
