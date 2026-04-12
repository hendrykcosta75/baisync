import Link from 'next/link'
import { notFound } from 'next/navigation'
import { LandingNavbar } from '@/components/landing-navbar'
import { LandingFooter } from '@/components/landing/landing-footer'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

interface ArticleSection {
  heading?: string
  paragraphs: string[]
  list?: string[]
  highlight?: string
}

interface Article {
  slug: string
  category: string
  title: string
  excerpt: string
  date: string
  readTime: string
  author: { name: string; role: string; initials: string }
  sections: ArticleSection[]
}

const articles: Article[] = [
  {
    slug: 'como-ia-transforma-atendimento',
    category: 'IA & Automação',
    title: 'Como a IA está transformando o atendimento ao cliente em 2026',
    excerpt: 'Descubra como empresas estão usando agentes de IA para responder clientes em segundos, qualificar leads automaticamente e escalar operações sem aumentar equipe.',
    date: '2 Abr 2026',
    readTime: '8 min',
    author: { name: 'Equipe Baisync', role: 'IA & Produto', initials: 'BS' },
    sections: [
      {
        heading: 'A era do atendimento instantâneo',
        paragraphs: [
          'Em 2026, a expectativa do consumidor mudou radicalmente. Pesquisas mostram que 73% dos clientes esperam uma resposta em menos de 5 minutos ao entrar em contato com uma empresa. O problema? A maioria das equipes de atendimento humano opera com tempos de resposta entre 30 minutos e 4 horas.',
          'É nesse gap que a inteligência artificial encontrou seu espaço mais transformador. Agentes de IA não dormem, não tiram férias e não ficam sobrecarregados com volume. Eles respondem em menos de 3 segundos, 24 horas por dia, 7 dias por semana.',
        ],
      },
      {
        heading: 'O que mudou nos últimos 2 anos',
        paragraphs: [
          'A grande virada aconteceu quando os modelos de linguagem (LLMs) evoluíram de "responder perguntas genéricas" para "entender contexto de negócio". Com técnicas como RAG (Retrieval-Augmented Generation), um agente de IA agora pode acessar a base de conhecimento específica da sua empresa — catálogo de produtos, políticas de troca, tabelas de preço — e dar respostas precisas e personalizadas.',
          'Antes, chatbots eram árvores de decisão rígidas. O cliente precisava navegar por menus e digitar palavras-chave exatas. Hoje, agentes de IA compreendem linguagem natural: "quero trocar meu pedido que chegou errado" é entendido com a mesma facilidade que "troca de produto defeituoso".',
        ],
        list: [
          'Compreensão de linguagem natural e gírias regionais',
          'Acesso em tempo real à base de conhecimento da empresa (RAG)',
          'Capacidade de escalar conversas para humanos quando necessário',
          'Integração nativa com WhatsApp, Telegram e Web Chat',
          'Aprendizado contínuo a partir do histórico de conversas',
        ],
      },
      {
        heading: 'Números que comprovam a transformação',
        paragraphs: [
          'Segundo dados agregados de mais de 200 empresas usando a plataforma Baisync, os resultados médios após 30 dias de implementação são:',
        ],
        highlight: 'Tempo de resposta: de 4 horas para menos de 3 segundos. Taxa de resolução no primeiro contato: 78%. Aumento em leads qualificados: 68%. Redução no custo de atendimento: 45%.',
      },
      {
        heading: 'Casos de uso mais comuns',
        paragraphs: [
          'O atendimento ao cliente é apenas a porta de entrada. Empresas estão usando agentes de IA para qualificação de leads (o agente faz perguntas estratégicas e classifica o lead antes de passar para o time comercial), suporte pós-venda (rastreamento de pedidos, políticas de troca, agendamento de serviços) e até vendas diretas no WhatsApp.',
          'Um caso que ilustra bem: uma loja de e-commerce de moda configurou seu agente para recomendar produtos com base no perfil do cliente. Em 60 dias, as vendas via WhatsApp cresceram 120%, com ticket médio 35% maior que o site.',
        ],
      },
      {
        heading: 'Como começar',
        paragraphs: [
          'A implementação de um agente de IA não precisa ser complexa. Plataformas como a Baisync permitem configurar um agente em menos de 10 minutos: você conecta seu canal (WhatsApp, Telegram), faz upload da sua base de conhecimento (PDFs, planilhas, FAQs) e ativa o agente.',
          'O segredo está na base de conhecimento. Quanto mais contexto o agente tem sobre seu negócio — produtos, preços, políticas, tom de voz — mais precisas e naturais são as respostas. A recomendação é começar com o FAQ da empresa e ir expandindo conforme o agente é utilizado.',
        ],
      },
    ],
  },
  {
    slug: 'whatsapp-business-guia-completo',
    category: 'Atendimento',
    title: 'Guia Completo: WhatsApp Business com IA em 2026',
    excerpt: 'Tudo que você precisa saber para automatizar seu atendimento no WhatsApp usando agentes inteligentes.',
    date: '28 Mar 2026',
    readTime: '12 min',
    author: { name: 'Equipe Baisync', role: 'Integrações', initials: 'BS' },
    sections: [
      {
        heading: 'Por que WhatsApp?',
        paragraphs: [
          'O WhatsApp é o canal de comunicação mais usado no Brasil, com mais de 197 milhões de usuários ativos. Para empresas, isso significa que seus clientes já estão lá — a questão é como atendê-los de forma eficiente.',
          'O WhatsApp Business API permite que empresas enviem e recebam mensagens em escala, mas gerenciar centenas de conversas simultâneas com equipe humana é insustentável. É aqui que agentes de IA entram: eles assumem a primeira linha de atendimento, respondem perguntas frequentes, qualificam leads e escalam apenas os casos que realmente precisam de intervenção humana.',
        ],
      },
      {
        heading: 'Configurando seu agente no WhatsApp',
        paragraphs: [
          'A integração com WhatsApp via Baisync utiliza o protocolo Baileys, que permite conectar seu número de WhatsApp diretamente à plataforma sem custos adicionais de API. O processo é simples:',
        ],
        list: [
          'Acesse o painel da Baisync e crie um novo agente',
          'Selecione WhatsApp como canal de integração',
          'Escaneie o QR Code para conectar seu número',
          'Faça upload da base de conhecimento (PDFs, docs, planilhas)',
          'Configure o tom de voz e as instruções do agente',
          'Ative e teste com uma mensagem de exemplo',
        ],
      },
      {
        heading: 'Boas práticas para atendimento via WhatsApp',
        paragraphs: [
          'Respostas rápidas são essenciais — o cliente espera resposta quase instantânea no WhatsApp. Configure seu agente para responder em menos de 5 segundos. Use linguagem natural e informal (mas profissional), adequada ao canal.',
          'Divida mensagens longas em blocos menores. No WhatsApp, ninguém quer ler um parágrafo de 500 palavras. Configure seu agente para quebrar respostas longas em mensagens separadas de 2-3 frases cada.',
          'Sempre ofereça uma saída humana. Mesmo o melhor agente de IA tem limitações. Configure gatilhos para escalar automaticamente para um atendente humano quando o cliente pedir ou quando o agente não souber responder.',
        ],
      },
      {
        heading: 'Métricas para acompanhar',
        paragraphs: [
          'Após ativar seu agente, monitore esses indicadores no dashboard da Baisync:',
        ],
        list: [
          'Tempo médio de resposta (meta: < 5s)',
          'Taxa de resolução sem escalação humana (meta: > 70%)',
          'Satisfação do cliente (NPS ou avaliação pós-atendimento)',
          'Volume de mensagens por hora/dia',
          'Taxa de conversão (leads que viraram clientes)',
          'Tópicos mais perguntados (para melhorar a base de conhecimento)',
        ],
      },
      {
        heading: 'Erros comuns a evitar',
        paragraphs: [
          'O erro número 1 é colocar o agente no ar sem uma base de conhecimento sólida. Se o agente não sabe responder, ele vai inventar — e respostas erradas destroem a confiança do cliente mais rápido que uma resposta lenta.',
          'Outro erro frequente é não configurar escalação humana. O agente deve saber reconhecer quando não consegue ajudar e transferir para um humano de forma transparente. Frases como "vou te conectar com um especialista" são melhores que ficar em loop.',
        ],
      },
    ],
  },
  {
    slug: 'roi-agentes-ia-atendimento',
    category: 'Cases',
    title: 'ROI de agentes de IA: números reais de 50 empresas brasileiras',
    excerpt: 'Analisamos dados de 50 empresas que implementaram atendimento com IA.',
    date: '20 Mar 2026',
    readTime: '10 min',
    author: { name: 'Equipe Baisync', role: 'Analytics', initials: 'BS' },
    sections: [
      {
        heading: 'Metodologia do estudo',
        paragraphs: [
          'Analisamos dados de 50 empresas brasileiras de diferentes segmentos (e-commerce, serviços, saúde, educação e varejo) que utilizam agentes de IA da Baisync há pelo menos 90 dias. Os dados foram coletados entre janeiro e março de 2026.',
          'Para cada empresa, comparamos métricas de atendimento antes e depois da implementação: tempo de resposta, volume de atendimento, taxa de conversão, custo operacional e satisfação do cliente.',
        ],
      },
      {
        heading: 'Resultados gerais',
        paragraphs: [
          'Os números são consistentes em todos os segmentos analisados. A redução no tempo de resposta foi o resultado mais imediato — em média, caiu de 3.5 horas para 4 segundos. Isso sozinho já gerou um aumento de 42% na taxa de conversão de leads em clientes.',
        ],
        highlight: 'Redução de 94% no tempo de resposta. Aumento de 68% em leads qualificados. Redução de 45% no custo de atendimento. NPS médio subiu de 32 para 71. 78% de resolução no primeiro contato.',
      },
      {
        heading: 'Case: TechShop (E-commerce de eletrônicos)',
        paragraphs: [
          'A TechShop vendia R$180K/mês via WhatsApp com uma equipe de 4 atendentes. Após implementar um agente Baisync com base de conhecimento de 200+ produtos, o faturamento via WhatsApp subiu para R$420K/mês em 60 dias. A equipe de 4 foi reduzida para 1 pessoa que atende apenas escalações complexas.',
          'O agente lida com 92% das interações sozinho: consultas de preço, disponibilidade, rastreamento de pedidos e recomendações personalizadas. O tempo de resposta caiu de 45 minutos para 2 segundos.',
        ],
      },
      {
        heading: 'Case: ClínicaVida (Saúde)',
        paragraphs: [
          'A ClínicaVida recebia em média 300 mensagens/dia no WhatsApp, a maioria para agendar consultas e tirar dúvidas sobre convênios. Com 2 recepcionistas dedicadas ao WhatsApp, o tempo de resposta era de 2 horas e 15% das mensagens ficavam sem resposta.',
          'O agente de IA agora responde 100% das mensagens em menos de 5 segundos. Ele agenda consultas automaticamente (integrado ao sistema de agenda), confirma convênios e envia lembretes. A taxa de no-show em consultas caiu 35% e as recepcionistas foram realocadas para atendimento presencial.',
        ],
      },
      {
        heading: 'Quanto custa vs quanto gera',
        paragraphs: [
          'O custo médio de um agente de IA na Baisync (plano Pro) é R$97/mês. O custo médio de um atendente humano dedicado ao WhatsApp é R$3.200/mês (salário + encargos). Em média, cada agente de IA substitui o trabalho de 2.5 atendentes na primeira linha.',
          'Considerando o plano Pro a R$97/mês e a economia de 2.5 salários (R$8.000/mês), o ROI é de 8.100% — sem contar o aumento de receita gerado pela velocidade de resposta e disponibilidade 24/7.',
        ],
      },
    ],
  },
  {
    slug: 'chatbot-vs-agente-ia',
    category: 'IA & Automação',
    title: 'Chatbot vs Agente de IA: qual a diferença e por que importa',
    excerpt: 'Chatbots seguem scripts rígidos. Agentes de IA entendem contexto, aprendem e tomam decisões.',
    date: '15 Mar 2026',
    readTime: '6 min',
    author: { name: 'Equipe Baisync', role: 'IA & Produto', initials: 'BS' },
    sections: [
      {
        heading: 'A confusão de termos',
        paragraphs: [
          'O mercado usa "chatbot" e "agente de IA" como se fossem a mesma coisa. Não são. A diferença é tão grande quanto entre uma calculadora e um computador — ambos fazem contas, mas um deles pode fazer muito mais.',
          'Um chatbot é um programa que segue regras pré-definidas. Se o cliente digita "horário", o chatbot responde com o horário de funcionamento. Se digita "quando vocês abrem", o chatbot pode não entender — porque foi programado para a palavra "horário", não para sinônimos.',
        ],
      },
      {
        heading: 'Como funciona um chatbot tradicional',
        paragraphs: [
          'Chatbots tradicionais operam com árvores de decisão ou detecção de palavras-chave. O fluxo é rígido: pergunta → identificar palavra-chave → resposta pré-programada. Se a pergunta não encaixa em nenhuma categoria, o chatbot trava ou entra em loop.',
        ],
        list: [
          'Regras if/else fixas',
          'Sem compreensão de contexto',
          'Não aprende com interações anteriores',
          'Não acessa dados em tempo real',
          'Frustração alta quando o cliente sai do "script"',
        ],
      },
      {
        heading: 'Como funciona um agente de IA',
        paragraphs: [
          'Um agente de IA usa modelos de linguagem (como GPT-4, Claude ou Gemini) para compreender a intenção real do cliente. Ele não depende de palavras-chave — entende contexto, nuance, gírias e até erros de digitação.',
          'Além disso, com RAG (Retrieval-Augmented Generation), o agente acessa a base de conhecimento da empresa em tempo real. Ele não "adivinha" respostas — ele consulta documentos, catálogos e políticas antes de responder.',
        ],
        list: [
          'Compreensão de linguagem natural',
          'Contexto da conversa (lembra o que foi dito antes)',
          'Acesso à base de conhecimento via RAG',
          'Capacidade de tomar decisões (escalar, recomendar, agendar)',
          'Melhora com o tempo a partir do feedback',
        ],
      },
      {
        heading: 'Na prática: a mesma pergunta, duas respostas',
        paragraphs: [
          'Cliente: "Meu pedido tá atrasado, já era pra ter chegado ontem, tô puto"',
          'Chatbot: "Não entendi. Digite 1 para rastreamento, 2 para troca, 3 para falar com atendente."',
          'Agente de IA: "Entendo sua frustração. Encontrei seu pedido #4521 — ele saiu do centro de distribuição ontem e está com a transportadora. A previsão atualizada é amanhã até às 14h. Quer que eu te avise quando sair para entrega?"',
          'A diferença é evidente: o agente entendeu a emoção, encontrou o pedido automaticamente, deu informação atualizada e ofereceu uma ação proativa.',
        ],
      },
      {
        heading: 'Quando um chatbot ainda faz sentido',
        paragraphs: [
          'Para fluxos extremamente simples e previsíveis (como menu de opções interno), um chatbot pode ser suficiente. Mas para atendimento ao cliente — onde cada interação é diferente — o agente de IA é categoricamente superior.',
          'A boa notícia: o custo de um agente de IA em 2026 é comparável ao de um chatbot sofisticado. Não faz mais sentido econômico escolher a opção inferior.',
        ],
      },
    ],
  },
  {
    slug: 'rag-base-conhecimento',
    category: 'Produto',
    title: 'Base de conhecimento com RAG: como seu agente aprende sobre seu negócio',
    excerpt: 'Explicamos como a tecnologia RAG permite que seu agente de IA acesse documentos, FAQs e dados internos.',
    date: '10 Mar 2026',
    readTime: '7 min',
    author: { name: 'Equipe Baisync', role: 'Engenharia', initials: 'BS' },
    sections: [
      {
        heading: 'O que é RAG?',
        paragraphs: [
          'RAG (Retrieval-Augmented Generation) é a tecnologia que permite que um modelo de IA acesse informações específicas da sua empresa antes de gerar uma resposta. Em vez de depender apenas do conhecimento geral do modelo, o agente busca dados relevantes na sua base de documentos.',
          'Pense assim: o modelo de linguagem é o "cérebro" do agente — ele sabe como conversar. A base de conhecimento com RAG é a "memória da empresa" — ela contém os detalhes específicos do seu negócio.',
        ],
      },
      {
        heading: 'Como funciona por baixo',
        paragraphs: [
          'Quando você faz upload de um documento na Baisync, ele passa por um processo de indexação:',
        ],
        list: [
          'O documento é dividido em trechos (chunks) de 500-1000 caracteres',
          'Cada trecho é transformado em um vetor numérico (embedding) de 1536 dimensões',
          'Os vetores são armazenados em um índice vetorial no banco de dados',
          'Quando o cliente faz uma pergunta, a pergunta também vira um vetor',
          'O sistema busca os trechos mais similares (vizinhos mais próximos)',
          'Os trechos relevantes são enviados ao LLM junto com a pergunta',
          'O LLM gera uma resposta baseada nos trechos encontrados',
        ],
      },
      {
        heading: 'Que tipos de documentos funcionam',
        paragraphs: [
          'A Baisync aceita diversos formatos: PDFs (catálogos, manuais, contratos), documentos Word, planilhas Excel (tabelas de preço, inventário), arquivos de texto e até páginas web via URL. O sistema extrai o texto, limpa formatação e indexa automaticamente.',
          'Dica: documentos bem estruturados com títulos, listas e parágrafos curtos geram respostas melhores. Um FAQ organizado por tópicos funciona melhor que um PDF com texto corrido de 50 páginas.',
        ],
      },
      {
        heading: 'Otimizando sua base de conhecimento',
        paragraphs: [
          'A qualidade da base de conhecimento é o fator número 1 na qualidade das respostas do agente. Aqui estão as práticas que recomendamos:',
        ],
        list: [
          'Comece com seu FAQ — são as perguntas que já sabem que os clientes fazem',
          'Inclua tabela de preços atualizada com todos os produtos/serviços',
          'Documente políticas de troca, garantia, entrega e pagamento',
          'Adicione informações de contato, horário de funcionamento e localização',
          'Descreva o tom de voz desejado nas instruções do agente',
          'Revise e atualize a base mensalmente',
        ],
      },
      {
        heading: 'Quando o agente não sabe responder',
        paragraphs: [
          'Se a pergunta do cliente não tem correspondência na base de conhecimento, o agente tem duas opções configuráveis: dizer honestamente que não tem essa informação (e oferecer alternativas, como falar com um humano), ou escalar automaticamente para um atendente.',
          'Nunca configure o agente para inventar respostas. É melhor um "não sei, vou te transferir" do que uma informação errada que pode gerar problemas legais ou perda de credibilidade.',
        ],
      },
    ],
  },
  {
    slug: 'multi-canal-atendimento-ia',
    category: 'Atendimento',
    title: 'Atendimento multi-canal: WhatsApp, Telegram e Web Chat com um único agente',
    excerpt: 'Configure uma vez, atenda em todos os canais. Veja como unificar seu atendimento.',
    date: '5 Mar 2026',
    readTime: '5 min',
    author: { name: 'Equipe Baisync', role: 'Integrações', initials: 'BS' },
    sections: [
      {
        heading: 'O desafio multi-canal',
        paragraphs: [
          'Seus clientes estão em canais diferentes. Alguns preferem WhatsApp, outros usam Telegram, alguns visitam seu site. O problema: gerenciar equipes separadas para cada canal é caro e cria experiências inconsistentes.',
          'Uma pergunta sobre prazo de entrega deveria ter a mesma resposta no WhatsApp e no Telegram. Mas quando equipes diferentes gerenciam canais diferentes, inconsistências são inevitáveis.',
        ],
      },
      {
        heading: 'Um agente, múltiplos canais',
        paragraphs: [
          'Na Baisync, um único agente de IA pode ser conectado a múltiplos canais simultaneamente. A mesma base de conhecimento, o mesmo tom de voz, as mesmas regras — mas adaptado ao formato de cada plataforma.',
          'No WhatsApp, as mensagens são mais curtas e informais. No Web Chat, podem ser um pouco mais detalhadas. O agente adapta o formato automaticamente, mantendo a consistência da informação.',
        ],
      },
      {
        heading: 'Como configurar',
        paragraphs: [
          'O processo é simples: crie seu agente uma vez com toda a base de conhecimento e instruções. Depois, adicione os canais:',
        ],
        list: [
          'WhatsApp: conecte via QR Code (Baileys) — sem custos de API',
          'Telegram: crie um bot no BotFather e cole o token na Baisync',
          'Web Chat: copie o widget embed e cole no HTML do seu site',
          'Instagram (em breve): conecte sua conta business',
        ],
      },
      {
        heading: 'Histórico unificado',
        paragraphs: [
          'Todas as conversas de todos os canais aparecem em um único dashboard. Você vê o volume por canal, os tópicos mais frequentes, tempo de resposta e satisfação — tudo em um lugar. Se um cliente falou no WhatsApp ontem e voltou no Web Chat hoje, o contexto é preservado.',
          'Isso também facilita a identificação de oportunidades: se 40% das perguntas no Telegram são sobre um produto específico, você sabe que deve melhorar a base de conhecimento sobre ele ou criar uma promoção direcionada.',
        ],
      },
      {
        heading: 'Resultados típicos',
        paragraphs: [
          'Empresas que ativam múltiplos canais com o mesmo agente reportam, em média, 35% mais interações totais (capturando clientes que não usariam WhatsApp) e 20% mais conversões (pela consistência na experiência). O custo adicional por canal é zero — é o mesmo agente.',
        ],
      },
    ],
  },
]

function getArticle(slug: string): Article | undefined {
  return articles.find((a) => a.slug === slug)
}

function getRelatedArticles(current: Article): Article[] {
  return articles
    .filter((a) => a.slug !== current.slug)
    .filter((a) => a.category === current.category)
    .slice(0, 2)
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const article = getArticle(slug)

  if (!article) {
    notFound()
  }

  const related = getRelatedArticles(article)

  return (
    <div className="min-h-screen bg-black text-white font-[family-name:var(--font-jetbrains-mono)]">
      <LandingNavbar />

      <article className="max-w-[780px] mx-auto px-6 lg:px-12 pt-24 pb-16">
        {/* Back link */}
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-xs text-[#666] hover:text-[#FF6B00] transition-colors duration-200 mb-10"
          style={{ fontFamily: mono }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
          Voltar ao blog
        </Link>

        {/* Header */}
        <header className="mb-12" style={{ animation: 'fadeSlideUp 0.6s ease both' }}>
          <div className="flex items-center gap-3 mb-5">
            <span
              className="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full"
              style={{
                fontFamily: mono,
                background: 'rgba(255,107,0,0.08)',
                color: '#FF6B00',
                border: '1px solid rgba(255,107,0,0.15)',
              }}
            >
              {article.category}
            </span>
            <span className="text-[11px] text-[#555]" style={{ fontFamily: mono }}>
              {article.date}
            </span>
            <span className="text-[#333]">·</span>
            <span className="text-[11px] text-[#555]" style={{ fontFamily: mono }}>
              {article.readTime} leitura
            </span>
          </div>

          <h1
            className="text-2xl md:text-3xl lg:text-4xl font-bold text-white leading-tight mb-6"
            style={{ fontFamily: mono, letterSpacing: -0.5 }}
          >
            {article.title}
          </h1>

          <p
            className="text-base text-[#888] leading-relaxed mb-8"
            style={{ fontFamily: mono }}
          >
            {article.excerpt}
          </p>

          {/* Author */}
          <div className="flex items-center gap-3 pb-8 border-b border-[#1a1a1a]">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white"
              style={{ background: 'linear-gradient(135deg, #FF6B00, #ff8533)' }}
            >
              {article.author.initials}
            </div>
            <div>
              <p className="text-sm font-medium text-white" style={{ fontFamily: mono }}>
                {article.author.name}
              </p>
              <p className="text-[11px] text-[#666]" style={{ fontFamily: mono }}>
                {article.author.role}
              </p>
            </div>
          </div>
        </header>

        {/* Article body */}
        <div style={{ animation: 'fadeSlideUp 0.6s ease 0.1s both' }}>
          {article.sections.map((section, i) => (
            <section key={i} className="mb-10">
              {section.heading && (
                <h2
                  className="text-lg md:text-xl font-bold text-white mb-4"
                  style={{ fontFamily: mono }}
                >
                  {section.heading}
                </h2>
              )}

              {section.paragraphs.map((p, j) => (
                <p
                  key={j}
                  className="text-sm leading-[1.85] text-[#999] mb-4"
                  style={{ fontFamily: mono }}
                >
                  {p}
                </p>
              ))}

              {section.list && (
                <ul className="my-5 space-y-2.5 pl-1">
                  {section.list.map((item, k) => (
                    <li key={k} className="flex items-start gap-3 text-sm text-[#999]" style={{ fontFamily: mono }}>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 mt-1">
                        <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="#FF6B00" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {item}
                    </li>
                  ))}
                </ul>
              )}

              {section.highlight && (
                <div
                  className="my-6 p-5 rounded-xl border border-[#FF6B00]/20 bg-[#FF6B00]/5"
                >
                  <p className="text-sm leading-[1.85] text-[#ccc] font-medium" style={{ fontFamily: mono }}>
                    {section.highlight}
                  </p>
                </div>
              )}
            </section>
          ))}
        </div>

        {/* CTA */}
        <div
          className="mt-12 p-8 rounded-2xl border border-[#1a1a1a] bg-[#0a0a0a] text-center"
          style={{ animation: 'fadeSlideUp 0.6s ease 0.2s both' }}
        >
          <h3 className="text-lg font-bold text-white mb-3" style={{ fontFamily: mono }}>
            Pronto para testar?
          </h3>
          <p className="text-sm text-[#666] mb-6" style={{ fontFamily: mono }}>
            Crie seu primeiro agente de IA em menos de 10 minutos. Sem cartão de crédito.
          </p>
          <Link
            href="/dashboard"
            className="inline-block text-center transition-all duration-200 hover:opacity-90"
            style={{
              fontFamily: mono,
              fontSize: 12,
              fontWeight: 700,
              color: '#000',
              background: '#FF6B00',
              padding: '12px 28px',
              borderRadius: 8,
              textDecoration: 'none',
              letterSpacing: 0.5,
              textTransform: 'uppercase',
            }}
          >
            Começar Grátis
          </Link>
        </div>

        {/* Related */}
        {related.length > 0 && (
          <div className="mt-16 pt-12 border-t border-[#1a1a1a]">
            <h3 className="text-base font-bold text-white mb-6" style={{ fontFamily: mono }}>
              Artigos relacionados
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {related.map((r) => (
                <Link key={r.slug} href={`/blog/${r.slug}`}>
                  <div className="group rounded-xl border border-[#1a1a1a] bg-[#0a0a0a] p-5 transition-all duration-300 hover:-translate-y-1 hover:border-[#FF6B00]/30">
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wider text-[#FF6B00] mb-2 block"
                      style={{ fontFamily: mono }}
                    >
                      {r.category}
                    </span>
                    <h4 className="text-sm font-bold text-white group-hover:text-[#FF6B00] transition-colors mb-2" style={{ fontFamily: mono }}>
                      {r.title}
                    </h4>
                    <p className="text-xs text-[#555]" style={{ fontFamily: mono }}>
                      {r.readTime} leitura
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </article>

      <LandingFooter />
    </div>
  )
}
