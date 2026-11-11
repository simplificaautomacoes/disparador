# Leilões

O seletor da aba Leilão oferece **Leilão padrão**, **Leilão Odysseia** e a opção
de cadastrar outros leilões. Cada um tem anotação, pausa, intervalo, fila e
histórico próprios. Os números/diálogos continuam compartilhados e respeitam
os limites por remetente.

O padrão mantém a configuração existente e a URL `/api/webhook/leilao`.
Odysseia pode usar `/api/webhook/leilao/odysseia`. O endpoint antigo também
identifica Odysseia quando recebe `leilao_id: "odysseia"` ou `origem: "odysseia"`.
Outros leilões usam `/api/webhook/leilao/{identificador}`.

## Anotação para o atendimento

O envio continua pelo diálogo cadastrado no ChatGuru. A anotação é gravada
antes da execução do diálogo; se uma anotação configurada for recusada, o
atendimento não é iniciado sem os dados do cliente.

Além dos campos anteriores, o painel Odysseia encaminha `banco_aprovado`,
`valor_liberado`, `parcelas`, `validade`, `data_nascimento`, `data_admissao`,
`capturado_em`, `delivery_id`, `external_id`, `email`, `telefones`, `whatsapps`
e `cnpj_empresa`. As variáveis ficam disponíveis como botões na anotação.

## Reprocessamento

No histórico, use **Reprocessar** em uma falha ou **Reprocessar falhas
exibidas**. O registro original volta à fila, preservando o JSON recebido.
Se estiver pausado, o leilão aguarda a retomada. Envios já concluídos continuam
protegidos pelo período de deduplicação configurado.

Timeouts de envio ficam como **Confirmar no ChatGuru** e não são repetidos
automaticamente. Confira o atendimento e só use **Confirmar e reprocessar**
quando tiver certeza de que a mensagem não foi enviada.

IDs de remetente e diálogo são limpos de espaços/tabulações na chamada à API,
inclusive para configurações já cadastradas.

## Desenvolvimento e testes

Instale `backend/requirements-dev.txt` em um ambiente virtual e execute, a
partir de `backend`, `python -m unittest discover -s tests -v`.
Os testes usam bancos temporários e APIs de envio simuladas.

Frontend: `npm ci` e `npm run build`. Para desenvolvimento, `npm run dev`
usa o backend em `127.0.0.1:8000`; a variável `BACKEND_URL` permite outro endereço.
