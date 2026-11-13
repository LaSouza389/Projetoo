"use strict";

import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  doc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { auth, db, firebaseConfig } from "./firebase-config.js";
import {
  aceitarConvite,
  atualizarQuadro,
  convidarUsuario,
  criarQuadro,
  excluirTarefa,
  escutarTarefas,
  excluirSprint,
  listarConvites,
  listarHistorico,
  listarMeusQuadros,
  listarMembros,
  listarSprints,
  migrarQuadroLegado,
  removerMembro,
  salvarSprint,
  salvarTarefa
} from "./quadros.js";

const $ = (seletor) => document.querySelector(seletor);
const COLUNA_BACKLOG = "backlog";
let quadrosUsuario = [];
let quadroAtual = null;
let tarefas = [];
let membros = [];
let sprints = [];
let escutarTarefasAtual = null;
let escutarBoardAtual = null;
let papelAtual = null;
let modoCadastro = false;
let acaoDialogo = null;
let temporizadorAviso = null;

const telaLogin = $("#tela-login");
const app = $("#inicio");
const aviso = $("#aviso");
const dialogo = $("#dialogo");
const camposDialogo = $("#campos-dialogo");
const statusTexto = $("#texto-status");
const statusSalvamento = $("#status-salvamento");

function mostrarAviso(mensagem) {
  aviso.textContent = mensagem;
  aviso.hidden = false;
  window.clearTimeout(temporizadorAviso);
  temporizadorAviso = window.setTimeout(() => { aviso.hidden = true; }, 6500);
}

function atualizarStatus(texto, erro = false) {
  statusTexto.textContent = texto;
  statusSalvamento.classList.toggle("erro", erro);
}

function podeEditar() {
  return papelAtual === "OWNER" || papelAtual === "EDITOR";
}

function criarCampo(definicao, valor) {
  const grupo = document.createElement("div");
  grupo.className = "campo-dialogo";
  const id = `campo-${definicao.nome}`;
  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = definicao.rotulo;
  grupo.append(label);
  const elemento = definicao.tipo === "textarea"
    ? document.createElement("textarea")
    : definicao.tipo === "select"
      ? document.createElement("select")
      : document.createElement("input");
  elemento.id = id;
  elemento.name = definicao.nome;
  if (definicao.tipo !== "textarea" && definicao.tipo !== "select") {
    elemento.type = definicao.tipo || "text";
  }
  if (definicao.maxLength) elemento.maxLength = definicao.maxLength;
  if (definicao.required) elemento.required = true;
  if (definicao.placeholder) elemento.placeholder = definicao.placeholder;
  if (definicao.tipo === "select") {
    for (const opcao of definicao.opcoes) {
      const option = document.createElement("option");
      option.value = opcao.value;
      option.textContent = opcao.label;
      elemento.append(option);
    }
  }
  elemento.value = valor ?? definicao.valorInicial ?? "";
  grupo.append(elemento);
  return grupo;
}

function abrirDialogo({ titulo, rotulo = "KANBAN", campos, inicial = {}, submit }) {
  $("#titulo-dialogo").textContent = titulo;
  $("#rotulo-dialogo").textContent = rotulo;
  camposDialogo.replaceChildren(...campos.map((campo) => criarCampo(campo, inicial[campo.nome])));
  $("#erro-dialogo").textContent = "";
  $("#erro-dialogo").classList.remove("visivel");
  acaoDialogo = submit;
  dialogo.showModal();
  camposDialogo.querySelector("input,textarea,select")?.focus();
}

function fecharDialogo() {
  dialogo.close();
  acaoDialogo = null;
  camposDialogo.replaceChildren();
  $("#erro-dialogo").textContent = "";
  $("#erro-dialogo").classList.remove("visivel");
}

function obterCamposDialogo() {
  return Object.fromEntries([...camposDialogo.querySelectorAll("[name]")].map((campo) => [campo.name, campo.value]));
}

$("#formulario-dialogo").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!acaoDialogo) return;
  const salvar = $("#salvar-dialogo");
  const erro = $("#erro-dialogo");
  salvar.disabled = true;
  erro.textContent = "";
  try {
    await acaoDialogo(obterCamposDialogo());
    fecharDialogo();
  } catch (falha) {
    console.error("A operação do quadro falhou.", falha);
    erro.textContent = falha.message || "Não foi possível concluir a operação.";
    erro.classList.add("visivel");
  } finally {
    salvar.disabled = false;
  }
});

$("#fechar-dialogo").addEventListener("click", fecharDialogo);
$("#cancelar-dialogo").addEventListener("click", fecharDialogo);
dialogo.addEventListener("click", (evento) => {
  if (evento.target === dialogo) fecharDialogo();
});

function pararListenersBoard() {
  escutarTarefasAtual?.();
  escutarBoardAtual?.();
  escutarTarefasAtual = null;
  escutarBoardAtual = null;
}

function encerrarAcessoRevogado(boardId) {
  if (quadroAtual?.id !== boardId) return;
  pararListenersBoard();
  quadroAtual = null;
  papelAtual = null;
  tarefas = [];
  $("#vista-quadro").hidden = true;
  $("#vista-quadros").hidden = false;
  $("#botao-voltar-quadros").hidden = true;
  renderizarListaQuadros();
  mostrarAviso("Seu acesso a este quadro foi removido.");
  atualizarListaQuadros().catch((erro) => {
    console.error("Não foi possível atualizar a lista após a remoção de acesso.", erro);
  });
}

async function atualizarListaQuadros() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  atualizarStatus("Carregando quadros");
  const quadros = await listarMeusQuadros();
  if (auth.currentUser?.uid !== uid) return;
  quadrosUsuario = quadros;
  renderizarListaQuadros();
  await atualizarConvites();
  if (auth.currentUser?.uid === uid) atualizarStatus("Conectado");
}

function renderizarListaQuadros() {
  const proprios = quadrosUsuario.filter((board) => board.papel === "OWNER");
  const compartilhados = quadrosUsuario.filter((board) => board.papel !== "OWNER");
  renderizarCartoesQuadro($("#lista-quadros"), proprios, "Você ainda não criou nenhum quadro.");
  renderizarCartoesQuadro($("#lista-quadros-compartilhados"), compartilhados, "Nenhum quadro foi compartilhado com você.");
}

function renderizarCartoesQuadro(lista, quadros, vazioTexto) {
  lista.replaceChildren();
  if (!quadros.length) {
    const vazio = document.createElement("p");
    vazio.className = "estado-vazio";
    vazio.textContent = vazioTexto;
    lista.append(vazio);
  }
  for (const board of quadros) {
    const cartao = document.createElement("article");
    cartao.className = "cartao-quadro";
    const titulo = document.createElement("h3");
    titulo.textContent = board.nome;
    const papel = document.createElement("span");
    papel.className = `badge badge-${board.papel.toLowerCase()}`;
    papel.textContent = board.papel === "OWNER" ? "Proprietário" : board.papel === "EDITOR" ? "Editor" : "Leitor";
    const abrir = document.createElement("button");
    abrir.type = "button";
    abrir.className = "botao-principal";
    abrir.textContent = "Abrir quadro";
    abrir.addEventListener("click", () => abrirQuadro(board.id));
    cartao.append(titulo, papel, abrir);
    lista.append(cartao);
  }
}

async function atualizarConvites() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const lista = $("#lista-convites");
  lista.replaceChildren();
  const convites = await listarConvites();
  if (auth.currentUser?.uid !== uid) return;
  if (!convites.length) {
    const vazio = document.createElement("p");
    vazio.className = "estado-vazio";
    vazio.textContent = "Nenhum convite pendente.";
    lista.append(vazio);
    return;
  }
  for (const convite of convites) {
    const linha = document.createElement("article");
    linha.className = "linha-convite";
    const texto = document.createElement("span");
    const board = quadrosUsuario.find((item) => item.id === convite.boardId);
    texto.textContent = `Convite para ${board?.nome || convite.boardNome || "um quadro"} como ${convite.papel}.`;
    const aceitar = document.createElement("button");
    aceitar.type = "button";
    aceitar.className = "botao-principal";
    aceitar.textContent = "Aceitar";
    aceitar.addEventListener("click", async () => {
      aceitar.disabled = true;
      try {
        await aceitarConvite(convite.id);
        await atualizarListaQuadros();
        mostrarAviso("Convite aceito. O quadro já está disponível em Meus quadros.");
      } catch (erro) {
        mostrarAviso(erro.message || "Não foi possível aceitar o convite.");
        aceitar.disabled = false;
      }
    });
    linha.append(texto, aceitar);
    lista.append(linha);
  }
}

function formatoColunas(board) {
  return Array.isArray(board.colunas) && board.colunas.length
    ? board.colunas
    : [
      { id: "a-fazer", nome: "A Fazer", limiteWip: 0 },
      { id: "em-andamento", nome: "Em Andamento", limiteWip: 0 },
      { id: "concluido", nome: "Concluído", limiteWip: 0 }
    ];
}

async function abrirQuadro(boardId) {
  const board = quadrosUsuario.find((item) => item.id === boardId);
  if (!board) {
    mostrarAviso("Este quadro não aparece mais na sua lista. Atualize e tente novamente.");
    await atualizarListaQuadros();
    return;
  }
  pararListenersBoard();
  quadroAtual = board;
  papelAtual = board.papel;
  tarefas = [];
  $("#vista-quadros").hidden = true;
  $("#vista-quadro").hidden = false;
  $("#botao-voltar-quadros").hidden = false;
  $("#nome-quadro").textContent = board.nome;
  $("#papel-quadro").textContent = papelAtual;
  $("#descricao-quadro").textContent = papelAtual === "VIEWER" ? "Acesso somente para visualização." : "Tarefas e colaboração do quadro.";
  $("#botao-convidar").hidden = papelAtual !== "OWNER";
  $("#botao-editar-quadro").hidden = papelAtual !== "OWNER";
  $("#botao-nova-sprint").hidden = papelAtual !== "OWNER";
  $("#botao-adicionar-backlog").hidden = !podeEditar();
  $("#titulo-aplicacao").textContent = board.nome;
  $("#subtitulo-aplicacao").textContent = `Quadro ${papelAtual.toLowerCase()}`;
  atualizarStatus("Carregando quadro");
  escutarBoardAtual = onSnapshot(doc(db, "quadros", boardId), (snapshot) => {
    if (!snapshot.exists() || quadroAtual?.id !== boardId) return;
    quadroAtual = { id: snapshot.id, ...snapshot.data(), papel: papelAtual };
    $("#nome-quadro").textContent = quadroAtual.nome;
    renderizarColunas();
  }, (erro) => {
    console.error("Não foi possível acompanhar as configurações do quadro.", erro);
    if (erro.code === "permission-denied") {
      encerrarAcessoRevogado(boardId);
      return;
    }
    mostrarAviso("Não foi possível atualizar o quadro em tempo real.");
  });
  escutarTarefasAtual = escutarTarefas(boardId, (dados) => {
    if (quadroAtual?.id !== boardId) return;
    tarefas = dados;
    renderizarColunas();
    atualizarStatus("Conectado");
  }, (erro) => {
    console.error("Não foi possível acompanhar as tarefas.", erro);
    if (erro.code === "permission-denied") {
      encerrarAcessoRevogado(boardId);
      return;
    }
    atualizarStatus("Erro de leitura", true);
    mostrarAviso("Não foi possível carregar as tarefas. Verifique as regras e sua participação no quadro.");
  });
  await Promise.all([carregarMembros(), carregarSprints()]);
}

function voltarParaQuadros() {
  pararListenersBoard();
  quadroAtual = null;
  papelAtual = null;
  $("#vista-quadro").hidden = true;
  $("#vista-quadros").hidden = false;
  $("#botao-voltar-quadros").hidden = true;
  $("#titulo-aplicacao").textContent = "Meus quadros";
  $("#subtitulo-aplicacao").textContent = "Organize o trabalho com sua equipe.";
  for (const id of ["painel-participantes", "painel-sprints", "painel-historico"]) $(`#${id}`).hidden = true;
  atualizarStatus("Conectado");
}

function criarCartao(tarefa) {
  const card = document.createElement("article");
  card.className = "cartao";
  card.dataset.id = tarefa.id;
  card.draggable = podeEditar();
  const titulo = document.createElement("h3");
  titulo.textContent = tarefa.titulo;
  card.append(titulo);
  if (tarefa.descricao) {
    const descricao = document.createElement("p");
    descricao.className = "cartao-descricao";
    descricao.textContent = tarefa.descricao;
    card.append(descricao);
  }
  const metadados = document.createElement("div");
  metadados.className = "metadados-cartao";
  const prioridade = document.createElement("span");
  prioridade.className = `badge prioridade-${(tarefa.prioridade || "MEDIA").toLowerCase()}`;
  prioridade.textContent = `Prioridade ${String(tarefa.prioridade || "MEDIA").toLowerCase()}`;
  metadados.append(prioridade);
  if (tarefa.responsavelId) {
    const responsavel = membros.find((item) => item.id === tarefa.responsavelId);
    const nome = document.createElement("span");
    nome.textContent = responsavel?.email || "Responsável atribuído";
    metadados.append(nome);
  }
  if (tarefa.prazo) {
    const prazo = document.createElement("span");
    prazo.textContent = `Prazo: ${tarefa.prazo}`;
    metadados.append(prazo);
  }
  if (tarefa.storyPoints != null) {
    const points = document.createElement("span");
    points.textContent = `${tarefa.storyPoints} pts`;
    metadados.append(points);
  }
  card.append(metadados);
  if (Array.isArray(tarefa.labels) && tarefa.labels.length) {
    const labels = document.createElement("div");
    labels.className = "labels-cartao";
    for (const label of tarefa.labels) {
      const tag = document.createElement("span");
      tag.className = "badge";
      tag.textContent = label;
      labels.append(tag);
    }
    card.append(labels);
  }
  if (Array.isArray(tarefa.checklist) && tarefa.checklist.length) {
    const concluidas = tarefa.checklist.filter((item) => item.concluida).length;
    const progresso = document.createElement("p");
    progresso.className = "progresso-checklist";
    progresso.textContent = `Checklist ${concluidas}/${tarefa.checklist.length}`;
    card.append(progresso);
  }
  const acoes = document.createElement("div");
  acoes.className = "acoes-cartao";
  const detalhes = document.createElement("a");
  detalhes.className = "botao-icone link-tarefa";
  detalhes.href = `./task.html?boardId=${encodeURIComponent(quadroAtual.id)}&taskId=${encodeURIComponent(tarefa.id)}`;
  detalhes.target = "_blank";
  detalhes.rel = "noopener";
  detalhes.textContent = "Abrir tarefa";
  acoes.append(detalhes);
  if (podeEditar()) {
    const excluir = document.createElement("button");
    excluir.type = "button";
    excluir.className = "botao-icone excluir";
    excluir.textContent = "Excluir";
    excluir.addEventListener("click", async () => {
      if (!window.confirm(`Excluir "${tarefa.titulo}"?`)) return;
      try {
        await excluirTarefa(quadroAtual.id, tarefa.id, {
          tipo: "TAREFA_EXCLUIDA",
          descricao: `Tarefa excluída: ${tarefa.titulo}`
        });
      } catch (erro) {
        console.error("Não foi possível excluir a tarefa.", erro);
        mostrarAviso(erro.message || "Não foi possível excluir a tarefa.");
      }
    });
    acoes.append(excluir);
  }
  card.append(acoes);
  card.addEventListener("dragstart", (evento) => {
    if (!podeEditar()) { evento.preventDefault(); return; }
    evento.dataTransfer.setData("text/plain", tarefa.id);
    evento.dataTransfer.effectAllowed = "move";
    card.classList.add("arrastando");
  });
  card.addEventListener("dragend", () => card.classList.remove("arrastando"));
  return card;
}

function renderizarColunas() {
  if (!quadroAtual) return;
  const quadro = $("#quadro");
  quadro.replaceChildren();
  for (const coluna of formatoColunas(quadroAtual)) {
    const secao = document.createElement("section");
    secao.className = "coluna";
    secao.dataset.coluna = coluna.id;
    const header = document.createElement("header");
    header.className = "cabecalho-coluna";
    const title = document.createElement("div");
    title.className = "identidade-coluna";
    const dot = document.createElement("span");
    dot.className = "ponto-coluna";
    const h2 = document.createElement("h2");
    h2.textContent = coluna.nome;
    title.append(dot, h2);
    const total = tarefas.filter((tarefa) => tarefa.coluna === coluna.id).length;
    const contador = document.createElement("span");
    contador.className = "contador";
    contador.textContent = coluna.limiteWip ? `${total}/${coluna.limiteWip}` : String(total);
    header.append(title, contador);
    const lista = document.createElement("div");
    lista.className = "lista-atividades";
    lista.append(...tarefas.filter((tarefa) => tarefa.coluna === coluna.id).map(criarCartao));
    const adicionar = document.createElement("button");
    adicionar.type = "button";
    adicionar.className = "botao-adicionar";
    adicionar.textContent = "+ Adicionar tarefa";
    adicionar.hidden = !podeEditar();
    adicionar.addEventListener("click", () => abrirCriarTarefa(coluna.id));
    secao.append(header, lista, adicionar);
    quadro.append(secao);
    secao.addEventListener("dragover", (evento) => {
      if (podeEditar()) evento.preventDefault();
    });
    secao.addEventListener("drop", async (evento) => {
      if (!podeEditar()) return;
      evento.preventDefault();
      const taskId = evento.dataTransfer.getData("text/plain");
      const tarefa = tarefas.find((item) => item.id === taskId);
      if (!tarefa || tarefa.coluna === coluna.id) return;
      const contagem = tarefas.filter((item) => item.coluna === coluna.id && item.id !== taskId).length;
      if (coluna.limiteWip > 0 && contagem >= coluna.limiteWip) {
        mostrarAviso(`O limite WIP da coluna "${coluna.nome}" foi atingido.`);
        return;
      }
      try {
        await salvarTarefa(quadroAtual.id, { ...tarefa, coluna: coluna.id }, tarefa.id, {
          tipo: "TAREFA_MOVIDA",
          descricao: `${tarefa.titulo}: ${tarefa.coluna} → ${coluna.id}`
        });
      } catch (erro) {
        mostrarAviso(erro.message || "Não foi possível mover a tarefa.");
      }
    });
  }
  const backlog = tarefas.filter((item) => item.coluna === COLUNA_BACKLOG);
  $("#lista-backlog").replaceChildren(...backlog.map(criarCartao));
  $("#contador-backlog").textContent = String(backlog.length);
  const backlogArea = $(".backlog");
  backlogArea.ondragover = (evento) => { if (podeEditar()) evento.preventDefault(); };
  backlogArea.ondrop = async (evento) => {
    if (!podeEditar()) return;
    evento.preventDefault();
    const taskId = evento.dataTransfer.getData("text/plain");
    const tarefa = tarefas.find((item) => item.id === taskId);
    if (!tarefa || tarefa.coluna === COLUNA_BACKLOG) return;
    try {
      await salvarTarefa(quadroAtual.id, { ...tarefa, coluna: COLUNA_BACKLOG }, tarefa.id, {
        tipo: "TAREFA_MOVIDA",
        descricao: `${tarefa.titulo}: enviada ao backlog`
      });
    } catch (erro) {
      mostrarAviso(erro.message || "Não foi possível mover a tarefa.");
    }
  };
}

function abrirCriarTarefa(coluna) {
  abrirDialogo({
    titulo: "Nova tarefa",
    rotulo: "TAREFA",
    campos: [
      { nome: "titulo", rotulo: "Título", required: true, maxLength: 120 },
      { nome: "descricao", rotulo: "Descrição", tipo: "textarea", maxLength: 4000 }
    ],
    submit: async ({ titulo, descricao }) => {
      const id = await salvarTarefa(quadroAtual.id, {
        titulo, descricao, coluna, prioridade: "MEDIA", labels: [], checklist: []
      }, null, {
        tipo: "TAREFA_CRIADA",
        descricao: `Tarefa criada: ${titulo}`
      });
    }
  });
}

async function carregarMembros() {
  try {
    membros = await listarMembros(quadroAtual.id);
    const lista = $("#lista-participantes");
    lista.replaceChildren();
    for (const membro of membros) {
      const linha = document.createElement("div");
      linha.className = "linha-participante";
      const texto = document.createElement("span");
      texto.textContent = `${membro.email || membro.userId} — ${membro.papel}`;
      linha.append(texto);
      if (papelAtual === "OWNER" && membro.papel !== "OWNER") {
        const remover = document.createElement("button");
        remover.type = "button";
        remover.className = "botao-icone excluir";
        remover.textContent = "Remover";
        remover.addEventListener("click", async () => {
          if (!window.confirm(`Remover ${membro.email || "este participante"} do quadro?`)) return;
          try {
            await removerMembro(quadroAtual.id, membro.id, {
              tipo: "MEMBRO_REMOVIDO",
              descricao: `Participante removido: ${membro.email || membro.userId}`
            });
            await carregarMembros();
            mostrarAviso("Participante removido.");
          } catch (erro) {
            mostrarAviso(erro.message || "Não foi possível remover o participante.");
          }
        });
        linha.append(remover);
      }
      lista.append(linha);
    }
  } catch (erro) {
    console.error("Não foi possível listar os participantes.", erro);
    mostrarAviso("Não foi possível carregar os participantes.");
  }
}

async function carregarSprints() {
  try {
    sprints = await listarSprints(quadroAtual.id);
    const lista = $("#lista-sprints");
    lista.replaceChildren();
    if (!sprints.length) {
      const vazio = document.createElement("p");
      vazio.className = "estado-vazio";
      vazio.textContent = "Nenhuma sprint criada.";
      lista.append(vazio);
      return;
    }
    for (const sprint of sprints) {
      const linha = document.createElement("article");
      linha.className = "linha-sprint";
      const texto = document.createElement("span");
      texto.textContent = `${sprint.nome} — ${sprint.status}${sprint.inicio ? ` (${sprint.inicio} a ${sprint.fim || "—"})` : ""}`;
      linha.append(texto);
      if (papelAtual === "OWNER") {
        const editar = document.createElement("button");
        editar.className = "botao-icone";
        editar.type = "button";
        editar.textContent = "Editar";
        editar.addEventListener("click", () => abrirDialogoSprint(sprint));
        linha.append(editar);
        const excluir = document.createElement("button");
        excluir.className = "botao-icone excluir";
        excluir.type = "button";
        excluir.textContent = "Excluir";
        excluir.addEventListener("click", async () => {
          if (!window.confirm(`Excluir a sprint "${sprint.nome}"? As tarefas associadas não serão excluídas.`)) return;
          try {
            if (tarefas.some((tarefa) => tarefa.sprintId === sprint.id)) {
              mostrarAviso("Desassocie as tarefas desta sprint antes de excluí-la.");
              return;
            }
            await excluirSprint(quadroAtual.id, sprint.id, {
              tipo: "SPRINT_EXCLUIDA",
              descricao: `Sprint excluída: ${sprint.nome}`
            });
            await carregarSprints();
          } catch (erro) {
            mostrarAviso(erro.message || "Não foi possível excluir a sprint.");
          }
        });
        linha.append(excluir);
      }
      lista.append(linha);
    }
  } catch (erro) {
    console.error("Não foi possível listar as sprints.", erro);
    mostrarAviso("Não foi possível carregar as sprints.");
  }
}

function abrirDialogoSprint(sprint = null) {
  if (papelAtual !== "OWNER") {
    mostrarAviso("Somente o proprietário pode gerenciar sprints.");
    return;
  }
  abrirDialogo({
    titulo: sprint ? "Editar sprint" : "Nova sprint",
    rotulo: "SCRUM",
    campos: [
      { nome: "nome", rotulo: "Nome", required: true, maxLength: 80 },
      { nome: "objetivo", rotulo: "Objetivo", tipo: "textarea", maxLength: 1000 },
      { nome: "inicio", rotulo: "Início", tipo: "date" },
      { nome: "fim", rotulo: "Fim", tipo: "date" },
      { nome: "status", rotulo: "Status", tipo: "select", opcoes: [
        { value: "PLANEJADA", label: "Planejada" },
        { value: "ATIVA", label: "Ativa" },
        { value: "CONCLUIDA", label: "Concluída" }
      ] }
    ],
    inicial: sprint || {},
    submit: async (dados) => {
      await salvarSprint(quadroAtual.id, dados, sprint?.id || null, {
        tipo: sprint ? "SPRINT_ATUALIZADA" : "SPRINT_CRIADA",
        descricao: `${sprint ? "Sprint atualizada" : "Sprint criada"}: ${dados.nome}`
      });
      await carregarSprints();
    }
  });
}

function abrirConfiguracaoQuadro() {
  const colunasTexto = formatoColunas(quadroAtual)
    .map((coluna) => `${coluna.id}|${coluna.nome}|${coluna.limiteWip || 0}`)
    .join("\n");
  abrirDialogo({
    titulo: "Configurar quadro",
    rotulo: "PROPRIETÁRIO",
    campos: [
      { nome: "nome", rotulo: "Nome do quadro", required: true, maxLength: 80 },
      { nome: "colunasTexto", rotulo: "Colunas (uma por linha: id|nome|limite WIP; 0 = sem limite)", tipo: "textarea", required: true, maxLength: 1000 }
    ],
    inicial: { nome: quadroAtual.nome, colunasTexto },
    submit: async ({ nome, colunasTexto: texto }) => {
      const colunas = texto.split(/\r?\n/).filter((linha) => linha.trim()).map((linha) => {
        const [id, nomeColuna, limite] = linha.split("|").map((parte) => parte.trim());
        return { id, nome: nomeColuna, limiteWip: Number(limite || 0) };
      });
      for (const coluna of colunas) {
        if (coluna.limiteWip > 0) {
          const contagem = tarefas.filter((tarefa) => tarefa.coluna === coluna.id).length;
          if (contagem > coluna.limiteWip) {
            throw new Error(`O limite WIP de "${coluna.nome}" não pode ficar abaixo das ${contagem} tarefas atuais.`);
          }
        }
      }
      const removidasComTarefas = formatoColunas(quadroAtual).filter((coluna) =>
        !colunas.some((nova) => nova.id === coluna.id) && tarefas.some((tarefa) => tarefa.coluna === coluna.id)
      );
      if (removidasComTarefas.length) throw new Error("Mova ou exclua as tarefas antes de remover uma coluna que ainda está em uso.");
      await atualizarQuadro(quadroAtual.id, {
        nome,
        colunas,
        atividade: {
          tipo: "QUADRO_CONFIGURADO",
          descricao: `Configurações do quadro atualizadas: ${nome}`
        }
      });
      await atualizarListaQuadros();
    }
  });
}

$("#botao-criar-quadro").addEventListener("click", () => {
  abrirDialogo({
    titulo: "Criar quadro",
    campos: [{ nome: "nome", rotulo: "Nome do quadro", required: true, maxLength: 80 }],
    submit: async ({ nome }) => {
      await criarQuadro(nome);
      await atualizarListaQuadros();
      mostrarAviso("Quadro criado.");
    }
  });
});

$("#botao-convidar").addEventListener("click", () => {
  abrirDialogo({
    titulo: "Convidar participante",
    rotulo: "COMPARTILHAMENTO",
    campos: [
      { nome: "email", rotulo: "E-mail da conta Firebase", tipo: "email", required: true, maxLength: 254 },
      { nome: "papel", rotulo: "Permissão", tipo: "select", opcoes: [
        { value: "EDITOR", label: "Editor — pode alterar tarefas" },
        { value: "VIEWER", label: "Leitor — somente visualização" }
      ] }
    ],
    submit: async ({ email, papel }) => {
      await convidarUsuario(quadroAtual.id, email, papel);
      mostrarAviso("Convite criado. O participante deverá entrar com esse e-mail e aceitá-lo.");
    }
  });
});

$("#botao-editar-quadro").addEventListener("click", abrirConfiguracaoQuadro);
$("#botao-voltar-quadros").addEventListener("click", voltarParaQuadros);
$("#botao-participantes").addEventListener("click", async () => {
  const painel = $("#painel-participantes");
  painel.hidden = !painel.hidden;
  if (!painel.hidden) await carregarMembros();
});
$("#botao-sprints").addEventListener("click", async () => {
  const painel = $("#painel-sprints");
  painel.hidden = !painel.hidden;
  if (!painel.hidden) await carregarSprints();
});
$("#botao-nova-sprint").addEventListener("click", () => abrirDialogoSprint());
$("#botao-historico").addEventListener("click", async () => {
  const painel = $("#painel-historico");
  painel.hidden = !painel.hidden;
  if (painel.hidden) return;
  try {
    const registros = await listarHistorico(quadroAtual.id);
    const lista = $("#lista-historico");
    lista.replaceChildren();
    for (const registro of registros) {
      const item = document.createElement("li");
      const data = registro.criadoEm?.toDate?.().toLocaleString("pt-BR") || "Agora";
      item.textContent = `${data} — ${registro.autorEmail || registro.autorId}: ${registro.descricao}`;
      lista.append(item);
    }
  } catch (erro) {
    mostrarAviso("Não foi possível carregar o histórico.");
  }
});
$("#botao-adicionar-backlog").addEventListener("click", () => abrirCriarTarefa(COLUNA_BACKLOG));

$("#botao-migrar").addEventListener("click", async () => {
  const botao = $("#botao-migrar");
  const status = $("#status-migracao");
  if (!window.confirm("A migração vai copiar as atividades antigas para um quadro novo. Nenhum dado antigo será apagado. Deseja continuar?")) return;
  botao.disabled = true;
  status.textContent = "Verificando o documento legado…";
  try {
    const resultado = await migrarQuadroLegado();
    if (resultado.status === "nao-encontrado") status.textContent = "Nenhum documento antigo de atividades foi encontrado para esta conta.";
    else if (resultado.status === "ja-concluida") status.textContent = `Migração já concluída. Quadro: ${resultado.boardId}.`;
    else status.textContent = `Migração concluída: ${resultado.total} tarefa(s). O documento antigo foi preservado.`;
    await atualizarListaQuadros();
  } catch (erro) {
    console.error("A migração não foi concluída.", erro);
    status.textContent = erro.message || "A migração foi interrompida. Os dados antigos foram preservados.";
  } finally {
    botao.disabled = false;
  }
});

$("#botao-sair").addEventListener("click", async () => {
  try { await signOut(auth); }
  catch (erro) {
    console.error("Não foi possível encerrar a sessão.", erro);
    mostrarAviso("Não foi possível sair da conta.");
  }
});

$("#botao-reenviar-verificacao").addEventListener("click", async (evento) => {
  const botao = evento.currentTarget;
  botao.disabled = true;
  try {
    if (!auth.currentUser || auth.currentUser.emailVerified) {
      $("#aviso-email").hidden = true;
      return;
    }
    await sendEmailVerification(auth.currentUser);
    mostrarAviso("E-mail de verificação enviado. Confira também a pasta de spam.");
  } catch (erro) {
    console.error("Não foi possível enviar o e-mail de verificação.", erro);
    mostrarAviso("Não foi possível enviar a verificação. Confira as configurações do Firebase Authentication.");
  } finally {
    botao.disabled = false;
  }
});

$("#botao-confirmar-verificacao").addEventListener("click", async (evento) => {
  evento.currentTarget.disabled = true;
  try {
    if (!auth.currentUser) throw new Error("Entre novamente na sua conta.");
    await auth.currentUser.reload();
    await auth.currentUser.getIdToken(true);
    if (!auth.currentUser.emailVerified) {
      mostrarAviso("O e-mail ainda não aparece como verificado. Abra o link enviado e tente novamente.");
      return;
    }
    $("#aviso-email").hidden = true;
    await atualizarConvites();
    mostrarAviso("E-mail confirmado. Você já pode aceitar convites.");
  } catch (erro) {
    console.error("Não foi possível atualizar o estado de verificação.", erro);
    mostrarAviso(erro.message || "Não foi possível confirmar a verificação.");
  } finally {
    evento.currentTarget.disabled = false;
  }
});

$("#alternar-senha").addEventListener("click", (evento) => {
  const senha = $("#senha-login");
  const exibir = senha.type === "password";
  senha.type = exibir ? "text" : "password";
  evento.currentTarget.textContent = exibir ? "Ocultar" : "Mostrar";
});

$("#alternar-cadastro").addEventListener("click", () => {
  modoCadastro = !modoCadastro;
  $("#mensagem-login").textContent = "";
  $("#titulo-login").textContent = modoCadastro ? "Criar sua conta" : "Acesse seu Kanban";
  $("#introducao-login").textContent = modoCadastro
    ? "Cadastre-se para começar a colaborar."
    : "Entre para organizar e compartilhar suas atividades.";
  $("#botao-entrar").textContent = modoCadastro ? "Criar conta" : "Entrar";
  $("#campo-confirmar-senha").hidden = !modoCadastro;
  $("#confirmar-senha").required = modoCadastro;
  $("#senha-login").autocomplete = modoCadastro ? "new-password" : "current-password";
  $("#alternar-cadastro").textContent = modoCadastro ? "Já tem conta? Entrar" : "Não tem conta? Criar conta";
});

$("#formulario-login").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const botao = $("#botao-entrar");
  const mensagem = $("#mensagem-login");
  botao.disabled = true;
  mensagem.textContent = "";
  try {
    const email = $("#email-login").value.trim();
    const senha = $("#senha-login").value;
    if (modoCadastro) {
      if (senha.length < 6) throw new Error("A senha precisa ter pelo menos 6 caracteres.");
      if (senha !== $("#confirmar-senha").value) throw new Error("As senhas não coincidem.");
      const credencial = await createUserWithEmailAndPassword(auth, email, senha);
      try {
        await sendEmailVerification(credencial.user);
      } catch (erroEmail) {
        console.error("Conta criada, mas a verificação por e-mail falhou.", erroEmail);
        mensagem.textContent = "Conta criada, mas o Firebase não conseguiu enviar a verificação. Entre na conta para tentar reenviar.";
        mostrarAviso("Conta criada, mas a verificação não foi enviada. Use o aviso no app para reenviar.");
        return;
      }
      await signOut(auth);
      $("#alternar-cadastro").click();
      mensagem.textContent = "Conta criada. Verifique seu e-mail antes de aceitar convites; depois, entre na sua conta.";
    } else {
      await signInWithEmailAndPassword(auth, email, senha);
    }
  } catch (erro) {
    console.error("Não foi possível autenticar.", erro);
    mensagem.textContent = erro.message.startsWith("A senha") || erro.message === "As senhas não coincidem."
      ? erro.message
      : traduzirErroAutenticacao(erro.code, modoCadastro);
  } finally {
    botao.disabled = false;
  }
});

function traduzirErroAutenticacao(codigo, cadastro) {
  const mensagens = {
    "auth/invalid-email": "Informe um e-mail válido.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde e tente novamente.",
    "auth/network-request-failed": "Falha de conexão. Verifique sua internet.",
    "auth/email-already-in-use": "Este e-mail já possui uma conta.",
    "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
    "auth/invalid-credential": "E-mail ou senha inválidos.",
    "auth/operation-not-allowed": "Habilite E-mail/senha em Authentication no Firebase."
  };
  return mensagens[codigo] || (cadastro ? "Não foi possível criar a conta." : "Não foi possível entrar. Verifique seus dados.");
}

onAuthStateChanged(auth, async (usuario) => {
  pararListenersBoard();
  quadroAtual = null;
  papelAtual = null;
  quadrosUsuario = [];
  $("#lista-convites").replaceChildren();
  renderizarListaQuadros();
  if (!usuario) {
    app.hidden = true;
    telaLogin.hidden = false;
    return;
  }
  const destino = new URLSearchParams(location.search).get("returnTo");
  if (destino) {
    try {
      const urlDestino = new URL(destino, location.origin);
      if (urlDestino.origin === location.origin && urlDestino.pathname.endsWith("/task.html")) {
        location.replace(urlDestino.href);
        return;
      }
    } catch (erro) {
      console.warn("O endereço de retorno foi ignorado por ser inválido.");
    }
  }
  telaLogin.hidden = true;
  app.hidden = false;
  $("#usuario-conectado").textContent = usuario.email || "Conta conectada";
  $("#aviso-email").hidden = Boolean(usuario.emailVerified);
  $("#vista-quadro").hidden = true;
  $("#vista-quadros").hidden = false;
  $("#botao-voltar-quadros").hidden = true;
  $("#botao-migrar").disabled = false;
  try {
    await atualizarListaQuadros();
    const boardSolicitado = new URLSearchParams(location.search).get("boardId");
    if (boardSolicitado && quadrosUsuario.some((board) => board.id === boardSolicitado)) {
      await abrirQuadro(boardSolicitado);
    }
    if (!usuario.emailVerified) {
      mostrarAviso("Confirme seu e-mail para aceitar convites destinados à sua conta.");
    }
  } catch (erro) {
    console.error("Não foi possível carregar quadros e convites.", erro);
    atualizarStatus("Erro ao carregar", true);
    mostrarAviso("Não foi possível carregar seus quadros. Confirme se as regras do Firestore foram publicadas pelo administrador.");
  }
});

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  $("#aviso-configuracao").textContent = "Configure os dados do app Firebase no arquivo firebase-config.js.";
  $("#aviso-configuracao").hidden = false;
  $("#botao-entrar").disabled = true;
  $("#alternar-cadastro").disabled = true;
}
