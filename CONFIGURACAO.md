# Kanban Colaborativo

Aplicação estática em HTML, CSS e JavaScript ES Modules. O Firebase SDK 11.6.0 é carregado pelo navegador; não há dependência de React, servidor Node.js ou npm para executar o site com Live Server ou Firebase Hosting.

## Recursos implementados

- Cadastro e login com Firebase Authentication (e-mail e senha).
- Verificação do e-mail da conta antes de aceitar convites, para impedir que uma conta não verificada reivindique um endereço convidado.
- Quadros próprios e quadros compartilhados, com papéis OWNER, EDITOR e VIEWER.
- Convites in-app direcionados ao e-mail cadastrado, aceitação transacional e gerenciamento de participantes pelo proprietário.
- Tarefas em colunas configuráveis, backlog, prioridade, labels, responsáveis, prazo, checklist, Story Points, critérios de aceitação e Definition of Done.
- Limite WIP verificado nas operações da interface. As regras do Firestore não garantem esse limite contra gravações diretas ou concorrentes.
- Sprints (gerenciadas somente pelo proprietário), comentários e histórico colaborativo informativo.
- Página de tarefa em `task.html`, acessível por URL, em nova aba e protegida pela participação no quadro.
- Migração legada manual e idempotente para `quadros/legado-{uid}`. O documento antigo e seu array `atividades` são mantidos.
- Regras do Firestore em `firestore.rules`.

Os convites aparecem dentro da aplicação quando a pessoa entra com o mesmo e-mail. **O projeto não envia e-mails de notificação.** Enviar mensagens por e-mail exigiria integrar um provedor de envio confiável (por exemplo, uma extensão ou serviço externo); essa integração não foi incluída nem é necessária para aceitar convites dentro do app.

## Preparar o Firebase

1. No Firebase Console, habilite **Authentication → Sign-in method → E-mail/senha** e confirme que o modelo de e-mail de verificação está ativo.
2. Crie ou selecione o banco em **Firestore Database**.
3. Confira se `firebase-config.js` contém a configuração do app Web do projeto Firebase pretendido. A configuração Web é pública por definição; a autorização dos dados depende das regras.
4. Publique `firestore.rules` e os índices pelo procedimento abaixo antes de testar os recursos colaborativos. **Este projeto local não publicou regras nem índices.**
5. Em Authentication → Settings, confira os domínios autorizados. `localhost` é necessário para testes locais caso ainda não esteja listado; adicione também o domínio real do Hosting quando publicar.

## Executar localmente

Abra `index.html` com Live Server. Cadastre duas contas Firebase diferentes para testar colaboração. O participante convidado precisa acessar com exatamente o e-mail convidado, entrar em **Convites recebidos** e aceitar o convite.

## Migração do quadro antigo

A migração não é automática. Entre na conta que possui o documento antigo `quadros/{uid}`, abra **Migrar atividades do quadro antigo** e confirme. O app:

1. Lê o array antigo sem o excluir.
2. Cria o quadro `quadros/legado-{uid}` e copia as tarefas para a subcoleção `tarefas`.
3. Usa IDs determinísticos e valida os documentos já copiados contra a origem. Divergências interrompem a migração sem sobrescrever dados.
4. Confere novamente a origem e as tarefas e grava os marcadores de conclusão do quadro novo e do documento antigo em uma única transação.

Em caso de erro durante a cópia, o documento antigo permanece intacto e a tentativa pode ser repetida. Se o processo for interrompido depois de cópias parciais, a repetição valida e reutiliza somente tarefas correspondentes. A migração não é uma transação única para todos os dados: as tarefas são copiadas em grupos e os marcadores finais são atômicos. Alterações concorrentes na origem interrompem a conclusão. Revise visualmente a cópia antes de usar o novo quadro.

## Regras e Firebase Hosting

As regras estão em `firestore.rules` e separam acesso de leitura e edição. Proprietários gerenciam o quadro, participantes e sprints; editores alteram tarefas/comentários; leitores só leem. Convites são aceitos pelo destinatário autenticado e com e-mail verificado em uma transação. Os índices necessários estão em `firestore.indexes.json`. As regras e índices não foram implantados pelo assistente.

As alterações feitas pela interface e seus eventos de histórico são gravados no mesmo lote, para evitar que uma ação apareça sem seu evento ou vice-versa. O histórico é colaborativo e informativo: usuários OWNER/EDITOR ainda podem inserir eventos por chamadas diretas autorizadas; portanto, ele não é uma trilha de auditoria inviolável. O limite WIP também é uma validação da interface, não uma garantia do backend.

Para validar ou publicar manualmente (não executar sem autorização):

```powershell
firebase emulators:start --only firestore
```

Para publicação, após instalar/configurar a Firebase CLI e selecionar o projeto correto:

```powershell
firebase deploy --only firestore
firebase deploy --only hosting
```

O deploy não foi executado. `firebase.json` usa a pasta do projeto como raiz estática do Hosting; `index.html`, `task.html` e os módulos JavaScript são servidos como arquivos estáticos.

## Testes manuais recomendados

1. Cadastre Usuário A e Usuário B.
2. Como A, crie um quadro, crie tarefa e convide B como EDITOR.
3. Como B, confirme o endereço pelo e-mail de verificação e entre novamente. Aceite o convite. Verifique que o quadro aparece em **Compartilhados comigo**, abra uma tarefa em nova aba, edite-a e adicione um comentário.
4. Repita com um convite VIEWER: confirme que a tarefa abre, mas campos, movimentação, comentários e ações de edição não são permitidos.
5. Como A, remova B e confirme que B perde o acesso após recarregar.
6. Configure WIP e tente ultrapassar o limite pela interface; confirme que a regra é apenas de UX. Crie coluna, backlog e sprint; verifique que somente OWNER pode criar, editar ou excluir sprints. Associe tarefas, responsável, labels, checklist e story points.
7. Em uma conta com documento legado, faça a migração manual; confira número e conteúdo das tarefas, recarregue e confirme que o app reporta migração já concluída e mantém o documento antigo.
8. Teste regras negativas com o Firestore Emulator: usuário não membro, alteração de papel próprio, convite para e-mail diferente, VIEWER tentando escrever, EDITOR tentando administrar membros/sprints e criação de comentário para tarefa inexistente.
