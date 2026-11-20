# Checkout — Combo Vitalício

Checkout de R$ 197 à vista no Pix, com a identidade visual da referência fornecida, Nexum Pay, notificações Pushcut e liberação manual pelo WhatsApp (75) 98839-3742.

## Executar

Node.js 24. Instale com `pnpm install`, copie `.env.example` para `.env.local` e preencha as credenciais. `pnpm dev` serve o projeto em `http://127.0.0.1:3000`. `pnpm test` executa os testes de contrato e segurança; `pnpm build` valida páginas, recursos e JavaScript.

## Configuração na Vercel

Defina no servidor (nunca em variáveis públicas):

- `NEXUM_CHAT_ID` e `NEXUM_API_CREDENTIAL`: Painel Nexum → Integração.
- `NEXUM_ORIGIN`: origem autorizada pela Nexum; padrão documentado `https://nexumpaybot.com`.
- `APP_URL`: URL pública de produção deste checkout.
- `CHECKOUT_SECRET`: segredo aleatório de pelo menos 32 bytes para assinar pedidos/sessões.
- `NEXUM_WEBHOOK_TOKEN`: segredo aleatório distinto de pelo menos 32 bytes.
- `PUSH_PENDING_URL` e `PUSH_PAID_URL`: endpoints privados de notificações fornecidos pelo responsável.
- `SUPPORT_WHATSAPP`: `5575988393742`.

Republique depois de alterar variáveis. O formulário informa indisponibilidade e bloqueia a criação se faltar configuração. O webhook `/api/pix/webhook` é enviado automaticamente em cada criação; não é necessário cadastrar os links do Pushcut diretamente na Nexum. O endpoint precisa estar público e sem autenticação da Vercel para a Nexum conseguir chamá-lo; sua autenticação é o header `X-Webhook-Token`.

## Fluxo e privacidade

O formulário valida nome, e-mail, telefone e CPF. Nome normalizado, e-mail e CPF seguem os campos documentados da Nexum. A API não documenta campo de telefone: ele é validado no formulário, não enviado em campo inventado e não persistido. Não há banco de dados próprio, por solicitação do responsável. Não são registrados dados pessoais nos logs da aplicação.

O preço é fixado no servidor. Tentativas repetidas com os mesmos dados e identificador usam a mesma chave de idempotência. Dados alterados produzem outra referência. Uma resposta PROCESSING continua sendo consultada, sem criar automaticamente outra cobrança. A aplicação consulta o status a cada 31 segundos ou mais e respeita Retry-After.

QR Code é produzido localmente a partir do copia e cola recebido. A sessão da aba guarda somente cobrança, QR, expiração e token assinado, sem dados cadastrais. Uma transação PAID redireciona para `/obrigado.html`; o servidor verifica o pagamento antes de expor a mensagem de aprovação e o link do WhatsApp. Abrir a página diretamente não prova pagamento. O comprovante/ID sempre deve ser conferido pela equipe antes de liberar conteúdo.

As notificações pendente/pago são acionadas pelos webhooks autenticados. Pagamento aprovado é reconsultado na Nexum e o valor conferido. Pushcut recebe produto, valor e ID, sem dados pessoais do comprador. Falhas de encaminhamento retornam HTTP 503 para a Nexum tentar novamente.

**Limite deliberado sem armazenamento:** não há deduplicação durável de notificações. Um webhook repetido ou um timeout após o Pushcut receber o evento pode gerar notificação repetida. Isso não cria uma segunda cobrança. A idempotência financeira é da Nexum. O polling não substitui a entrega dos webhooks. Não há recuperação de sessão entre dispositivos nem envio automático de acesso.

Não foram incluídas datas relativas, parcelamento, garantia de resultado clínico, sorteios ou brindes por ordem de compra que exigiriam calendário/controle de elegibilidade próprios. Os 4 bônus gerais e os 7 dias de garantia da oferta fornecida estão na página.

## Validação

`node --test` cobre CPF, preço, idempotência, adulteração/expiração de sessão, status/valor, autenticação do webhook, referências de outros pedidos, falha do Pushcut, limites da operadora e proteção da origem. São testes com respostas simuladas; não geram cobranças nem disparam notificações reais. Ativação final exige credencial Nexum válida e um teste de cobrança/pagamento real autorizado pelo responsável.

Documentação utilizada: https://app.nexumpaybot.com/api/index.html

