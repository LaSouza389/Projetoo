# Meu quadro Kanban · Guia de configuração independente

Este guia explica como configurar seu próprio Firebase, executar o projeto em outro computador e publicá-lo. Cada pessoa deve usar um projeto Firebase e contas próprias. Não compartilhe senhas.

## O que você vai precisar

- Os arquivos deste projeto no computador.
- Uma conta Google para acessar o Firebase Console.
- Visual Studio Code e a extensão Live Server para executar localmente.
- Node.js e Firebase CLI somente para publicar o projeto.

## 1. Criar e preparar o projeto Firebase

1. Acesse [Firebase Console](https://console.firebase.google.com/) e crie um projeto.
2. No projeto, adicione um app do tipo Web (`</>`) e registre-o.
3. Na configuração do app Web, copie os valores de `firebaseConfig`.
4. No Firebase Console, abra **Authentication → Método de login** e habilite **E-mail/senha**.
5. Em **Authentication → Usuários**, crie as contas que poderão acessar o quadro.
6. Abra **Firestore Database** e crie um banco de dados. Escolha com atenção a localização, pois ela não pode ser alterada depois.
7. Publique as regras de `firestore.rules` pelo Firebase CLI, conforme a seção de publicação abaixo. As regras permitem que cada conta leia e altere somente o próprio quadro.

Não crie uma coleção manualmente. O app cria o documento `quadros/{uid}` no primeiro acesso autenticado.

> O login desta versão usa o e-mail cadastrado no Firebase Authentication e a respectiva senha. Autenticação por nome de usuário exige um serviço adicional seguro para resolver nomes em contas; não exponha uma lista pública de e-mails no Firestore.

## 2. Configurar o app neste computador

1. Abra `firebase-config.js`.
2. Substitua os valores vazios pelos valores copiados da configuração do seu app Web. Mantenha as aspas e os nomes das propriedades.
3. Salve o arquivo.
4. No VS Code, abra `index.html` com a extensão Live Server.
5. Entre com uma das contas criadas em **Authentication → Usuários**.

Não é necessário executar `npm install`. O SDK do Firebase é carregado pelo navegador. A configuração do app Web é usada no cliente; a proteção dos dados depende das regras do Firestore, que devem permanecer restritas como no arquivo fornecido.

As atividades da versão anterior, salvas apenas no armazenamento local do navegador, não são copiadas automaticamente para a nuvem. Elas permanecem no navegador original.

## 3. Publicar no Firebase Hosting

1. Instale o Node.js e a Firebase CLI, se ainda não estiverem instalados.
2. No terminal do VS Code, na pasta do projeto, execute:

   ```powershell
   npm install -g firebase-tools
   firebase login
   firebase use --add
   ```

   Selecione o projeto Firebase criado na etapa 1.
3. Confirme que `firebase-config.js` contém a configuração do seu app Web.
4. Publique o site e as regras:

   ```powershell
   firebase deploy --only hosting,firestore:rules
   ```

5. Ao terminar, o Firebase CLI exibirá a URL pública do Firebase Hosting. Em **Authentication → Configurações → Domínios autorizados**, confirme que o domínio de hospedagem está autorizado.

O Node.js não é necessário para executar o projeto com Live Server, mas é necessário para instalar e executar a Firebase CLI usada nesta etapa.
