import { FlatCache } from 'flat-cache'

import posthtml from 'posthtml'
import beautify from 'posthtml-beautify'

export async function formatHtmlForPrompt(
    input: Response,
) {
    const html = await input.text()

    const tagsToRemove = [
        'hint',
        'style',
        'link',
        'script',
        'meta',
        'noscript',
        'svg',
        'head',
        // 'head',
    ]
    const attributesToKeep = [
        'data-framer-name',
        // 'class',
        // 'id',
        'label',
        'title',
        'alt',
        'href',
        'name',
        'value',
        'checked',
        'placeholder',
        'type',
        'role',
        // 'src',
        'target',
        'data-llm-id',
        'vimium-label',
    ]

    // Create a custom plugin to remove tags and filter attributes
    const removeTagsAndAttrsPlugin = () => {
        return (tree) => {
            // Remove comments at root level
            tree = tree.filter((item) => {
                if (typeof item === 'string') {
                    const trimmed = item.trim()
                    return !(trimmed.startsWith('<!--') && trimmed.endsWith('-->'))
                }
                return true
            })

            // Process each node recursively
            const processNode = (node) => {
                if (typeof node === 'string') {
                    return node
                }

                // Remove unwanted tags
                if (node.tag && tagsToRemove.includes(node.tag.toLowerCase())) {
                    return null
                }

                // Filter attributes
                if (node.attrs) {
                    const newAttrs: typeof node.attrs = {}
                    for (const [attr, value] of Object.entries(node.attrs)) {
                        if (attr.startsWith('aria-') || attributesToKeep.includes(attr)) {
                            newAttrs[attr] = value
                        }
                    }
                    node.attrs = newAttrs
                }

                // Process content recursively
                if (node.content && Array.isArray(node.content)) {
                    node.content = node.content
                        .map(processNode)
                        .filter(item => {
                            if (item === null) return false
                            if (typeof item === 'string') {
                                const trimmed = item.trim()
                                return !(trimmed.startsWith('<!--') && trimmed.endsWith('-->'))
                            }
                            return true
                        })
                }

                return node
            }

            // Process all root nodes
            return tree.map(processNode).filter(item => item !== null)
        }
    }

    // Process HTML
    const processor = posthtml()
        .use(removeTagsAndAttrsPlugin())
        .use(beautify({
            rules: {
                indent: 1,          // 1-space indent
                blankLines: false,  // no extra blank lines
                maxlen: 100000      // effectively never wrap by content length
            },
            jsBeautifyOptions: {
                wrap_line_length: 0,     // disable js-beautify wrapping
                preserve_newlines: false // reduce stray newlines
            }
        }))

    // Process with await
    const result = await processor.process(html)

    return result.html
}

const htmlCache = new FlatCache({
    cacheDir: '.htmlcache',
    cacheId: 'htmlcache.json',
    lruSize: 100,
})
export async function fetchFormattedHtml({
    url,
    signal,
    timeout = 5000,
}: {
    url: string
    signal?: AbortSignal
    timeout?: number
}): Promise<string> {
    if (!url) {
        return ''
    }
    if (htmlCache.get(url)) {
        return htmlCache.get(url) || ''
    }
    // if there is no https:// or http:// prefix, add it
    if (!url.startsWith('https://') && !url.startsWith('http://')) {
        url = 'https://' + url
    }
    console.time(`fetchFormattedHtml: ${url}`)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
        controller.abort()
    }, timeout)

    if (signal) {
        signal.addEventListener('abort', () => {
            controller.abort()
        })
    }

    try {
        const res = await fetch(url, {
            headers: {
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                Connection: 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                // Referer: 'https://www.google.com/',
                'User-Agent':
                    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
            },
            signal: controller.signal,
        })

        if (!res.ok) {
            console.timeEnd(`fetchFormattedHtml: ${url}`)
            throw new Error(
                `Could not get content, server responded with ${res.status}`,
            )
        }

        console.time(`formatHtmlForPrompt: ${url}`)
        const formattedHtml = await formatHtmlForPrompt(res)
        htmlCache.set(url, formattedHtml)
        htmlCache.save(true)
        console.timeEnd(`formatHtmlForPrompt: ${url}`)
        console.timeEnd(`fetchFormattedHtml: ${url}`)
        return formattedHtml
    } catch (error) {
        if (error.name === 'AbortError') {
            console.timeEnd(`fetchFormattedHtml: ${url}`)
            throw new Error(`${url} took too long to respond`)
        }
        throw error
    } finally {
        clearTimeout(timeoutId)
    }
}
