import React, { useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { cn } from '@renderer/lib/utils'
import { Copy, Check } from 'lucide-react'

/**
 * Syntax highlighting driven by Gothic's own --color-syntax-* tokens instead of
 * the bundled One Dark theme, whose saturated palette clashed with Gothic's
 * muted surfaces. Prism token classes map onto Astryx's token categories.
 */
const t = (name: string): { color: string } => ({ color: `var(--color-syntax-${name})` })

const gothicSyntax: Record<string, React.CSSProperties> = {
  'code[class*="language-"]': { color: 'var(--color-syntax-variable)' },
  'pre[class*="language-"]': {
    color: 'var(--color-syntax-variable)',
    background: 'var(--color-syntax-background)'
  },
  comment: { ...t('comment'), fontStyle: 'italic' },
  prolog: t('comment'),
  cdata: t('comment'),
  doctype: t('punctuation'),
  punctuation: t('punctuation'),
  operator: t('operator'),
  keyword: t('keyword'),
  'attr-name': t('attribute'),
  'attr-value': t('string'),
  string: t('string'),
  char: t('string'),
  number: t('number'),
  boolean: t('constant'),
  constant: t('constant'),
  symbol: t('constant'),
  function: t('function'),
  'class-name': t('type'),
  builtin: t('type'),
  tag: t('tag'),
  selector: t('tag'),
  property: t('property'),
  variable: t('variable'),
  regex: t('string'),
  important: { ...t('keyword'), fontWeight: 'bold' },
  deleted: t('tag'),
  inserted: t('string')
}

function CopyButton({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])

  return (
    <button
      onClick={handleCopy}
      className="absolute right-2 top-2 rounded-md bg-background/80 p-1.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-background"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-success" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </button>
  )
}

interface MarkdownContentProps {
  content: string
  className?: string
}

export function MarkdownContent({ content, className }: MarkdownContentProps): React.JSX.Element {
  return (
    <div className={cn('prose prose-sm dark:prose-invert max-w-none break-words overflow-hidden', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className: codeClassName, children, ...props }) {
            const match = /language-(\w+)/.exec(codeClassName || '')
            const codeString = String(children).replace(/\n$/, '')

            if (match) {
              return (
                <div className="group relative not-prose my-3 overflow-hidden rounded-lg">
                  {/* Header shares the syntax background so it seams cleanly
                      into the highlighted block below. */}
                  <div className="flex items-center justify-between rounded-t-lg border border-b-0 bg-syntax px-4 py-1.5">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      {match[1]}
                    </span>
                  </div>
                  <CopyButton text={codeString} />
                  <SyntaxHighlighter
                    style={gothicSyntax}
                    language={match[1]}
                    PreTag="div"
                    customStyle={{
                      margin: 0,
                      borderTopLeftRadius: 0,
                      borderTopRightRadius: 0,
                      borderBottomLeftRadius: '0.5rem',
                      borderBottomRightRadius: '0.5rem',
                      fontSize: '0.8rem',
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-syntax-background)'
                    }}
                  >
                    {codeString}
                  </SyntaxHighlighter>
                </div>
              )
            }

            return (
              <code
                className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono break-all before:content-none after:content-none"
                {...props}
              >
                {children}
              </code>
            )
          },

          pre({ children }) {
            return <>{children}</>
          },

          table({ children }) {
            return (
              <div className="not-prose my-4 overflow-x-auto rounded-lg border">
                <table className="md-table w-full text-sm">{children}</table>
              </div>
            )
          },

          thead({ children }) {
            return <thead className="md-thead">{children}</thead>
          },

          th({ children }) {
            return (
              <th className="border-b bg-muted/50 px-4 py-2 text-left text-xs font-semibold">
                {children}
              </th>
            )
          },

          td({ children }) {
            return (
              <td className="border-b border-border/50 px-4 py-2 text-xs">{children}</td>
            )
          },

          tr({ children }) {
            return <tr className="transition-colors hover:bg-muted/30">{children}</tr>
          },

          blockquote({ children }) {
            return (
              <blockquote className="border-l-2 border-primary/40 pl-4 italic text-muted-foreground">
                {children}
              </blockquote>
            )
          },

          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary/60"
              >
                {children}
              </a>
            )
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
