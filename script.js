
"use strict";

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

import {
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

const COLUNAS = ["a-fazer", "em-andamento", "concluido"];

const quadro = document.querySelector("#quadro");
const telaLogin = document.querySelector("#tela-login");
const app = document.querySelector(".app");

const formularioLogin = document.querySelector("#formulario-login");
const campoEmailLogin = document.querySelector("#email-login");
const campoSenhaLogin = document.querySelector("#senha-login");
const mensagemLogin = document.querySelector("#mensagem-login");
const avisoConfiguracao = document.querySelector("#aviso-configuracao");
const botaoEntrar = document.querySelector("#botao-entrar");
const botaoSair = document.querySelector("#botao-sair");
const usuarioConectado = document.querySelector("#usuario-conectado");

const tituloLogin = document.querySelector("#titulo-login");
const introducaoLogin = document.querySelector("#introducao-login");
const campoConfirmarSenha = document.querySelector("#confirmar-senha");
const areaConfirmarSenha = document.querySelector("#campo-confirmar-senha");
const botaoAlternarCadastro = document.querySelector("#alternar-cadastro");

const dialogo = document.querySelector("#dialogo-atividade");
const formulario = document.querySelector("#formulario-atividade");
const campoTitulo = document.querySelector("#titulo-atividade");
const campoDescricao = document.querySelector("#descricao-atividade");
const tituloDialogo = document.querySelector("#titulo-dialogo");
const botaoSalvar = document.querySelector("#salvar-atividade");
const erroFormulario = document.querySelector("#erro-formulario");
const aviso = document.querySelector("#aviso");
const statusSalvamento = document.querySelector("#status-salvamento");

let atividades = [];
let contextoFormulario = null;
let temporizadorToque = null;
let arrastoToque = null;
let temporizadorAviso = null;
let usuarioAtual = null;
let persistenciaAtiva = false;
let filaSalvamento = Promise.resolve();
let revisaoAtividades = 0;
let geracaoSessao = 0;
let modoCadastro = false;

const firebaseConfigCompleta = Boolean(
  firebaseConfig.apiKey
  && firebaseConfig.authDomain
  && firebaseConfig.projectId
  && firebaseConfig.appId
);

let auth = null;
let db = null;

if (firebaseConfigCompleta) {
  const firebaseApp = initializeApp(firebaseConfig);
  auth = getAuth(firebaseApp);
  db = getFirestore(firebaseApp);
} else {
  avisoConfiguracao.textContent =
    "Configure os dados do app Web no arquivo firebase-config.js para habilitar o login.";
  avisoConfiguracao.hidden = false;
  botaoEntrar.disabled = true;
  botaoAlternarCadastro.disabled = true;
}

function atividadeValida(atividade) {
  return atividade !== null
    && typeof atividade === "object"
    && typeof atividade.id === "string"
    && typeof atividade.titulo === "string"
    && typeof atividade.descricao === "string"
    && COLUNAS.includes(atividade.coluna);
}

function atualizarStatusSalvamento(mensagem, erro = false) {
  statusSalvamento.classList.toggle("erro", erro);
  statusSalvamento.lastChild.textContent = ` ${mensagem}`;
}

function salvarAtividades() {
  if (!persistenciaAtiva || !usuarioAtual) return;

  const uid = usuarioAtual.uid;
  const revisao = ++revisaoAtividades;
  const copiaAtividades = atividades.map((atividade) => ({ ...atividade }));

  atualizarStatusSalvamento("Salvando no Firebase");

  filaSalvamento = filaSalvamento.then(async () => {
    if (!usuarioAtual || usuarioAtual.uid !== uid) return;

    await setDoc(doc(db, "quadros", uid), {
      atividades: copiaAtividades,
      atualizadoEm: serverTimestamp()
    });

    if (usuarioAtual?.uid === uid && revisao === revisaoAtividades) {
      atualizarStatusSalvamento("Salvo na nuvem");
    }
  }).catch((erro) => {
    console.error("Não foi possível salvar as atividades no Firebase.", erro);

    if (usuarioAtual?.uid === uid && revisao === revisaoAtividades) {
      atualizarStatusSalvamento("Erro ao salvar", true);
      mostrarAviso(
        "Não foi possível salvar o quadro na nuvem. Verifique sua conexão e as regras do Firestore."
      );
    }
  });
}

function mostrarAviso(mensagem) {
  aviso.textContent = mensagem;
  aviso.hidden = false;

  window.clearTimeout(temporizadorAviso);

  temporizadorAviso = window.setTimeout(() => {
    aviso.hidden = true;
  }, 6000);
}

function criarId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function renderizar() {
  for (const coluna of COLUNAS) {
    const lista = quadro.querySelector(`[data-lista="${coluna}"]`);
    const itens = atividades.filter(
      (atividade) => atividade.coluna === coluna
    );

    lista.replaceChildren(...itens.map(criarCartao));

    const contador = lista.closest(".coluna").querySelector(".contador");

    contador.textContent = String(itens.length);
    contador.setAttribute(
      "aria-label",
      `${itens.length} ${itens.length === 1 ? "atividade" : "atividades"}`
    );
  }
}

function criarCartao(atividade) {
  const cartao = document.createElement("article");
  cartao.className = "cartao";
  cartao.dataset.id = atividade.id;
  cartao.draggable = true;

  const titulo = document.createElement("h3");
  titulo.textContent = atividade.titulo;
  cartao.append(titulo);

  if (atividade.descricao) {
    const descricao = document.createElement("p");
    descricao.className = "cartao-descricao";
    descricao.textContent = atividade.descricao;
    cartao.append(descricao);
  }

  const acoes = document.createElement("div");
  acoes.className = "acoes-cartao";

  const alcaArrastar = document.createElement("button");
  alcaArrastar.type = "button";
  alcaArrastar.className = "alca-arrastar";
  alcaArrastar.textContent = "⠿";
  alcaArrastar.setAttribute(
    "aria-label",
    `Arrastar atividade: ${atividade.titulo}`
  );
  alcaArrastar.title = "Segure e arraste para mover";
  alcaArrastar.addEventListener("pointerdown", iniciarArrastoToque);
  alcaArrastar.addEventListener("pointermove", moverArrastoToque);
  alcaArrastar.addEventListener("pointerup", finalizarArrastoToque);
  alcaArrastar.addEventListener("pointercancel", cancelarArrastoToque);
  acoes.append(alcaArrastar);

  const editar = document.createElement("button");
  editar.type = "button";
  editar.className = "botao-icone";
  editar.textContent = "Editar";
  editar.setAttribute("aria-label", `Editar ${atividade.titulo}`);
  editar.addEventListener("click", () =>
    abrirFormulario(atividade.coluna, atividade.id)
  );
  acoes.append(editar);

  const excluir = document.createElement("button");
  excluir.type = "button";
  excluir.className = "botao-icone excluir";
  excluir.textContent = "Excluir";
  excluir.setAttribute("aria-label", `Excluir ${atividade.titulo}`);
  excluir.addEventListener("click", () =>
    excluirAtividade(atividade.id)
  );
  acoes.append(excluir);

  cartao.append(acoes);
  cartao.addEventListener("dragstart", iniciarArrastoNativo);
  cartao.addEventListener("dragend", finalizarArrastoNativo);

  return cartao;
}

function abrirFormulario(coluna, id = null) {
  contextoFormulario = { coluna, id };

  const atividade = id
    ? atividades.find((item) => item.id === id)
    : null;

  campoTitulo.value = atividade?.titulo ?? "";
  campoDescricao.value = atividade?.descricao ?? "";

  tituloDialogo.textContent = atividade
    ? "Editar atividade"
    : "Adicionar atividade";

  botaoSalvar.textContent = atividade
    ? "Salvar alterações"
    : "Adicionar atividade";

  erroFormulario.textContent = "";
  erroFormulario.classList.remove("visivel");

  dialogo.showModal();
  campoTitulo.focus();
}

function fecharFormulario() {
  dialogo.close();
  contextoFormulario = null;
  formulario.reset();
  erroFormulario.textContent = "";
  erroFormulario.classList.remove("visivel");
}

function excluirAtividade(id) {
  const atividade = atividades.find((item) => item.id === id);

  if (!atividade) return;

  if (!window.confirm(`Excluir a atividade "${atividade.titulo}"?`)) {
    return;
  }

  atividades = atividades.filter((item) => item.id !== id);

  salvarAtividades();
  renderizar();
}

function moverAtividade(id, colunaDestino) {
  if (!COLUNAS.includes(colunaDestino)) return;

  const atividade = atividades.find((item) => item.id === id);

  if (!atividade || atividade.coluna === colunaDestino) return;

  atividade.coluna = colunaDestino;

  salvarAtividades();
  renderizar();
}

function iniciarArrastoNativo(evento) {
  if (evento.target.closest(".acoes-cartao")) {
    evento.preventDefault();
    return;
  }

  evento.dataTransfer.effectAllowed = "move";
  evento.dataTransfer.setData(
    "text/plain",
    evento.currentTarget.dataset.id
  );

  evento.currentTarget.classList.add("arrastando");
}

function finalizarArrastoNativo(evento) {
  evento.currentTarget.classList.remove("arrastando");
}

function iniciarArrastoToque(evento) {
  if (evento.pointerType !== "touch" || arrastoToque) return;

  const cartao = evento.currentTarget.closest(".cartao");

  if (!cartao) return;

  const dados = {
    id: cartao.dataset.id,
    cartao,
    iniciou: false,
    xInicial: evento.clientX,
    yInicial: evento.clientY
  };

  temporizadorToque = window.setTimeout(() => {
    dados.iniciou = true;
    arrastoToque = dados;
    cartao.classList.add("arrastando");
    document.body.classList.add("arrasto-toque-ativo");
  }, 180);

  arrastoToque = dados;
}

function moverArrastoToque(evento) {
  if (evento.pointerType !== "touch" || !arrastoToque) return;

  if (!arrastoToque.iniciou) {
    const distanciaX = evento.clientX - arrastoToque.xInicial;
    const distanciaY = evento.clientY - arrastoToque.yInicial;

    if (distanciaX ** 2 + distanciaY ** 2 > 144) {
      window.clearTimeout(temporizadorToque);
      temporizadorToque = null;
      arrastoToque = null;
    }

    return;
  }

  evento.preventDefault();

  const elemento = document.elementFromPoint(
    evento.clientX,
    evento.clientY
  );

  const coluna = elemento?.closest("[data-coluna]");

  quadro.querySelectorAll(".coluna.em-destaque").forEach((item) =>
    item.classList.remove("em-destaque")
  );

  coluna?.classList.add("em-destaque");
}

function finalizarArrastoToque(evento) {
  if (evento.pointerType !== "touch" || !arrastoToque) return;

  const arrasto = arrastoToque;

  if (arrasto.iniciou) {
    const elemento = document.elementFromPoint(
      evento.clientX,
      evento.clientY
    );

    const colunaDestino = elemento?.closest("[data-coluna]");

    if (colunaDestino) {
      moverAtividade(arrasto.id, colunaDestino.dataset.coluna);
    }
  }

  limparArrastoToque(arrasto);
}

function cancelarArrastoToque(evento) {
  if (evento.pointerType === "touch" && arrastoToque) {
    limparArrastoToque(arrastoToque);
  }
}

function limparArrastoToque(arrasto) {
  window.clearTimeout(temporizadorToque);
  temporizadorToque = null;

  arrasto.cartao.classList.remove("arrastando");
  document.body.classList.remove("arrasto-toque-ativo");

  quadro.querySelectorAll(".coluna.em-destaque").forEach((item) =>
    item.classList.remove("em-destaque")
  );

  arrastoToque = null;
}

quadro.addEventListener("click", (evento) => {
  const botao = evento.target.closest("[data-adicionar]");

  if (botao) {
    abrirFormulario(botao.dataset.adicionar);
  }
});

quadro.addEventListener("dragover", (evento) => {
  const coluna = evento.target.closest("[data-coluna]");

  if (!coluna) return;

  evento.preventDefault();
  evento.dataTransfer.dropEffect = "move";

  quadro.querySelectorAll(".coluna.em-destaque").forEach((item) =>
    item.classList.remove("em-destaque")
  );

  coluna.classList.add("em-destaque");
});

quadro.addEventListener("dragleave", (evento) => {
  const coluna = evento.target.closest("[data-coluna]");

  if (coluna && !coluna.contains(evento.relatedTarget)) {
    coluna.classList.remove("em-destaque");
  }
});

quadro.addEventListener("drop", (evento) => {
  const coluna = evento.target.closest("[data-coluna]");

  if (!coluna) return;

  evento.preventDefault();

  const id = evento.dataTransfer.getData("text/plain");

  moverAtividade(id, coluna.dataset.coluna);
  coluna.classList.remove("em-destaque");
});

formulario.addEventListener("submit", (evento) => {
  evento.preventDefault();

  const titulo = campoTitulo.value.trim();

  if (!titulo) {
    erroFormulario.textContent =
      "Informe um título para a atividade.";
    erroFormulario.classList.add("visivel");
    campoTitulo.focus();
    return;
  }

  if (!contextoFormulario) return;

  const descricao = campoDescricao.value.trim();

  if (contextoFormulario.id) {
    const atividade = atividades.find(
      (item) => item.id === contextoFormulario.id
    );

    if (!atividade) {
      mostrarAviso(
        "A atividade não foi encontrada. Feche o formulário e tente novamente."
      );

      fecharFormulario();
      return;
    }

    atividade.titulo = titulo;
    atividade.descricao = descricao;
  } else {
    atividades.push({
      id: criarId(),
      titulo,
      descricao,
      coluna: contextoFormulario.coluna
    });
  }

  salvarAtividades();
  renderizar();
  fecharFormulario();
});

document.querySelector("#fechar-dialogo")
  .addEventListener("click", fecharFormulario);

document.querySelector("#cancelar-dialogo")
  .addEventListener("click", fecharFormulario);

dialogo.addEventListener("click", (evento) => {
  if (evento.target === dialogo) {
    fecharFormulario();
  }
});

document.querySelector("#alternar-senha")
  .addEventListener("click", (evento) => {
    const botao = evento.currentTarget;
    const mostrar = campoSenhaLogin.type === "password";

    campoSenhaLogin.type = mostrar ? "text" : "password";
    botao.textContent = mostrar ? "Ocultar" : "Mostrar";

    botao.setAttribute(
      "aria-label",
      mostrar ? "Ocultar senha" : "Mostrar senha"
    );

    botao.setAttribute("aria-pressed", String(mostrar));
  });

// Alternar entre login e cadastro
botaoAlternarCadastro.addEventListener("click", () => {
  modoCadastro = !modoCadastro;

  mensagemLogin.textContent = "";
  campoSenhaLogin.value = "";
  campoConfirmarSenha.value = "";

  if (modoCadastro) {
    tituloLogin.textContent = "Criar sua conta";

    introducaoLogin.textContent =
      "Cadastre-se para começar a organizar suas atividades.";

    botaoEntrar.textContent = "Criar conta";
    campoSenhaLogin.autocomplete = "new-password";

    areaConfirmarSenha.hidden = false;
    campoConfirmarSenha.required = true;

    botaoAlternarCadastro.textContent =
      "Já tem uma conta? Entrar";
  } else {
    tituloLogin.textContent = "Acesse seu Kanban";

    introducaoLogin.textContent =
      "Entre para continuar organizando suas atividades.";

    botaoEntrar.textContent = "Entrar";
    campoSenhaLogin.autocomplete = "current-password";

    areaConfirmarSenha.hidden = true;
    campoConfirmarSenha.required = false;

    botaoAlternarCadastro.textContent =
      "Não tem uma conta? Criar conta";
  }
});

// Login e criação de conta
formularioLogin.addEventListener("submit", async (evento) => {
  evento.preventDefault();

  if (!auth) return;

  mensagemLogin.textContent = "";
  botaoEntrar.disabled = true;

  botaoEntrar.textContent = modoCadastro
    ? "Criando conta..."
    : "Entrando...";

  try {
    const email = campoEmailLogin.value.trim();
    const senha = campoSenhaLogin.value;

    if (modoCadastro) {
      const confirmarSenha = campoConfirmarSenha.value;

      if (senha.length < 6) {
        mensagemLogin.textContent =
          "A senha precisa ter pelo menos 6 caracteres.";
        return;
      }

      if (senha !== confirmarSenha) {
        mensagemLogin.textContent =
          "As senhas não coincidem.";
        return;
      }

      await createUserWithEmailAndPassword(auth, email, senha);
    } else {
      await signInWithEmailAndPassword(auth, email, senha);
    }
  } catch (erro) {
    console.error("Não foi possível autenticar o usuário.", erro);

    mensagemLogin.textContent = traduzirErroAutenticacao(
      erro.code,
      modoCadastro
    );
  } finally {
    botaoEntrar.disabled = false;

    botaoEntrar.textContent = modoCadastro
      ? "Criar conta"
      : "Entrar";
  }
});

function traduzirErroAutenticacao(codigo, cadastro = false) {
  if (codigo === "auth/invalid-email") {
    return "Informe um endereço de e-mail válido.";
  }

  if (codigo === "auth/too-many-requests") {
    return "Muitas tentativas. Aguarde um pouco e tente novamente.";
  }

  if (codigo === "auth/network-request-failed") {
    return "Não foi possível conectar. Verifique sua internet e tente novamente.";
  }

  if (codigo === "auth/user-disabled") {
    return "Esta conta está desativada. Fale com a pessoa responsável pelo projeto.";
  }

  if (codigo === "auth/email-already-in-use") {
    return "Este e-mail já possui uma conta. Tente entrar.";
  }

  if (codigo === "auth/weak-password") {
    return "Escolha uma senha mais segura, com pelo menos 6 caracteres.";
  }

  if (
    codigo === "auth/invalid-credential"
    || codigo === "auth/user-not-found"
    || codigo === "auth/wrong-password"
  ) {
    return cadastro
      ? "Não foi possível criar a conta. Confira os dados e tente novamente."
      : "E-mail ou senha inválidos.";
  }

  if (codigo === "auth/operation-not-allowed") {
    return "O cadastro por e-mail e senha não está habilitado no Firebase.";
  }

  return cadastro
    ? "Não foi possível criar sua conta. Confira os dados e tente novamente."
    : "Não foi possível entrar. Confira seus dados e tente novamente.";
}

botaoSair.addEventListener("click", async () => {
  if (!auth) return;

  botaoSair.disabled = true;

  try {
    await signOut(auth);
  } catch (erro) {
    console.error("Não foi possível encerrar a sessão.", erro);

    mostrarAviso(
      "Não foi possível sair da conta. Verifique sua conexão e tente novamente."
    );
  } finally {
    botaoSair.disabled = false;
  }
});

// Verificar sessão e carregar o quadro individual do usuário
if (auth && db) {
  onAuthStateChanged(auth, async (usuario) => {
    const geracao = ++geracaoSessao;

    persistenciaAtiva = false;
    usuarioAtual = usuario;
    mensagemLogin.textContent = "";

    if (!usuario) {
      atividades = [];
      app.hidden = true;
      telaLogin.hidden = false;
      usuarioConectado.textContent = "";
      renderizar();
      return;
    }

    telaLogin.hidden = true;
    app.hidden = false;

    usuarioConectado.textContent =
      usuario.email || "Conta conectada";

    atualizarStatusSalvamento("Carregando quadro");

    try {
      const referenciaQuadro = doc(
        db,
        "quadros",
        usuario.uid
      );

      const quadroSalvo = await getDoc(referenciaQuadro);

      if (geracao !== geracaoSessao) return;

      if (!quadroSalvo.exists()) {
        atividades = [];

        await setDoc(referenciaQuadro, {
          atividades,
          atualizadoEm: serverTimestamp()
        });
      } else {
        const dados = quadroSalvo.data();

        if (
          !Array.isArray(dados.atividades)
          || !dados.atividades.every(atividadeValida)
        ) {
          throw new Error(
            "O quadro salvo no Firestore não tem o formato esperado."
          );
        }

        atividades = dados.atividades;
      }

      if (geracao !== geracaoSessao) return;

      persistenciaAtiva = true;

      renderizar();
      atualizarStatusSalvamento("Salvo na nuvem");
    } catch (erroCarregamento) {
      console.error(
        "Não foi possível carregar o quadro do Firebase.",
        erroCarregamento
      );

      if (geracao !== geracaoSessao) return;

      atividades = [];
      renderizar();

      atualizarStatusSalvamento("Erro ao carregar", true);

      mostrarAviso(
        "Não foi possível carregar seu quadro. Confira a conexão e as regras do Firestore antes de tentar novamente."
      );
    }
  }, (erro) => {
    geracaoSessao += 1;

    console.error(
      "Não foi possível verificar a sessão do usuário.",
      erro
    );

    app.hidden = true;
    telaLogin.hidden = false;

    mensagemLogin.textContent =
      "Não foi possível verificar sua sessão. Recarregue a página e tente novamente.";
  });
}

renderizar();
