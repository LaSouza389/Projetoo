import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import {
  adicionarComentario,
  listarComentarios,
  listarMembros,
  listarSprints,
  salvarTarefa
} from "./quadros.js";

const params = new URLSearchParams(location.search);
const boardId = params.get("boardId");
const taskId = params.get("taskId");
const $ = (selector) => document.querySelector(selector);
let tarefaAtual = null;
let papel = null;
let checklist = [];
let pararMonitoramentoMembro = null;

function informar(mensagem, erro = false) {
  $("#status-tarefa").textContent = mensagem;
  $("#status-tarefa").classList.toggle("texto-erro", erro);
}

function preencherSelect(select, opcoes, atual, placeholder = null) {
  select.replaceChildren();
  if (placeholder) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = placeholder;
    select.append(option);
  }
  for (const item of opcoes) {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    select.append(option);
  }
  select.value = atual ?? "";
}

function renderizarChecklist() {
  const container = $("#itens-checklist");
  container.replaceChildren();
  for (const [indice, item] of checklist.entries()) {
    const linha = document.createElement("div");
    linha.className = "linha-checklist";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = item.concluida;
    check.disabled = papel === "VIEWER";
    check.setAttribute("aria-label", `Concluída: ${item.texto}`);
    check.addEventListener("change", () => { checklist[indice].concluida = check.checked; });
    const texto = document.createElement("input");
    texto.type = "text";
    texto.maxLength = 200;
    texto.value = item.texto;
    texto.disabled = papel === "VIEWER";
    texto.setAttribute("aria-label", "Descrição da subtarefa");
    texto.addEventListener("input", () => { checklist[indice].texto = texto.value; });
    linha.append(check, texto);
    if (papel !== "VIEWER") {
      const remover = document.createElement("button");
      remover.type = "button";
      remover.className = "botao-icone excluir";
      remover.textContent = "Remover";
      remover.addEventListener("click", () => {
        checklist = checklist.filter((_, itemIndice) => itemIndice !== indice);
        renderizarChecklist();
      });
      linha.append(remover);
    }
    container.append(linha);
  }
}

async function carregarComentarios() {
  const comentarios = await listarComentarios(boardId, taskId);
  const lista = $("#lista-comentarios");
  lista.replaceChildren();
  if (!comentarios.length) {
    const vazio = document.createElement("p");
    vazio.className = "estado-vazio";
    vazio.textContent = "Ainda não há comentários.";
    lista.append(vazio);
  }
  for (const comentario of comentarios) {
    const item = document.createElement("article");
    item.className = "comentario";
    const autoria = document.createElement("strong");
    autoria.textContent = comentario.autorEmail || "Participante";
    const data = document.createElement("time");
    data.textContent = comentario.criadoEm?.toDate?.().toLocaleString("pt-BR") || "Agora";
    const texto = document.createElement("p");
    texto.textContent = comentario.texto;
    item.append(autoria, data, texto);
    lista.append(item);
  }
}

async function carregar(usuario) {
  if (!boardId || !taskId || boardId.includes("/") || taskId.includes("/")) {
    informar("O link da tarefa está incompleto ou inválido.", true);
    return;
  }
  const membroSnap = await getDoc(doc(db, "quadros", boardId, "membros", usuario.uid));
  if (!membroSnap.exists()) {
    informar("Sua conta não participa deste quadro. Entre com o e-mail convidado e aceite o convite.", true);
    return;
  }
  papel = membroSnap.data().papel;
  pararMonitoramentoMembro?.();
  pararMonitoramentoMembro = onSnapshot(
    doc(db, "quadros", boardId, "membros", usuario.uid),
    (snapshot) => {
      if (!snapshot.exists()) {
        $("#conteudo-tarefa").hidden = true;
        informar("Seu acesso a este quadro foi removido.", true);
        pararMonitoramentoMembro?.();
        pararMonitoramentoMembro = null;
      }
    },
    (erro) => {
      console.error("Não foi possível acompanhar sua permissão na tarefa.", erro);
      if (erro.code === "permission-denied") {
        $("#conteudo-tarefa").hidden = true;
        informar("Não foi possível confirmar seu acesso ao quadro.", true);
      }
    }
  );
  const [boardSnap, taskSnap, membros, sprints] = await Promise.all([
    getDoc(doc(db, "quadros", boardId)),
    getDoc(doc(db, "quadros", boardId, "tarefas", taskId)),
    listarMembros(boardId),
    listarSprints(boardId)
  ]);
  if (!boardSnap.exists() || !taskSnap.exists()) {
    informar("Quadro ou tarefa não encontrado.", true);
    return;
  }
  tarefaAtual = { id: taskSnap.id, ...taskSnap.data() };
  document.title = `${tarefaAtual.titulo} | Kanban`;
  $("h1").textContent = tarefaAtual.titulo;
  $("#link-quadro").href = `./index.html?boardId=${encodeURIComponent(boardId)}`;
  preencherSelect($("#coluna-tarefa"), [
    { value: "backlog", label: "Backlog" },
    ...(Array.isArray(boardSnap.data().colunas) && boardSnap.data().colunas.length
      ? boardSnap.data().colunas
      : [
        { id: "a-fazer", nome: "A Fazer" },
        { id: "em-andamento", nome: "Em Andamento" },
        { id: "concluido", nome: "Concluído" }
      ])
      .map((coluna) => ({ value: coluna.id, label: coluna.nome }))
  ], tarefaAtual.coluna);
  preencherSelect($("#responsavel-tarefa"),
    membros.map((membro) => ({ value: membro.id, label: membro.email || membro.userId })),
    tarefaAtual.responsavelId, "Sem responsável");
  preencherSelect($("#sprint-tarefa"),
    sprints.map((sprint) => ({ value: sprint.id, label: sprint.nome })),
    tarefaAtual.sprintId, "Sem sprint");

  $("#titulo-tarefa").value = tarefaAtual.titulo || "";
  $("#descricao-tarefa").value = tarefaAtual.descricao || "";
  $("#prazo-tarefa").value = tarefaAtual.prazo || "";
  $("#prioridade-tarefa").value = tarefaAtual.prioridade || "MEDIA";
  $("#pontos-tarefa").value = tarefaAtual.storyPoints ?? "";
  $("#labels-tarefa").value = Array.isArray(tarefaAtual.labels) ? tarefaAtual.labels.join(", ") : "";
  $("#criterios-tarefa").value = tarefaAtual.criteriosAceitacao || "";
  $("#dod-tarefa").value = tarefaAtual.definitionOfDone || "";
  checklist = Array.isArray(tarefaAtual.checklist) ? tarefaAtual.checklist.map((item) => ({ ...item })) : [];
  renderizarChecklist();
  const somenteLeitura = papel === "VIEWER";
  for (const campo of $("#formulario-tarefa").querySelectorAll("input,textarea,select")) campo.disabled = somenteLeitura;
  $("#salvar-tarefa").hidden = somenteLeitura;
  $("#adicionar-checklist").hidden = somenteLeitura;
  $("#enviar-comentario").disabled = somenteLeitura;
  $("#texto-comentario").disabled = somenteLeitura;
  $("#conteudo-tarefa").hidden = false;
  informar(somenteLeitura ? "Acesso somente para visualização." : `Permissão: ${papel}.`);
  await carregarComentarios();
}

$("#adicionar-checklist").addEventListener("click", () => {
  checklist.push({ id: crypto.randomUUID(), texto: "", concluida: false });
  renderizarChecklist();
  $("#itens-checklist input[type=text]:last-of-type")?.focus();
});

$("#formulario-tarefa").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const botao = $("#salvar-tarefa");
  const erro = $("#erro-tarefa");
  erro.textContent = "";
  botao.disabled = true;
  try {
    const titulo = $("#titulo-tarefa").value.trim();
    const dados = {
      ...tarefaAtual,
      titulo,
      descricao: $("#descricao-tarefa").value,
      coluna: $("#coluna-tarefa").value,
      responsavelId: $("#responsavel-tarefa").value || null,
      prazo: $("#prazo-tarefa").value || null,
      prioridade: $("#prioridade-tarefa").value,
      labels: $("#labels-tarefa").value.split(",").map((label) => label.trim()).filter(Boolean),
      checklist: checklist.filter((item) => item.texto.trim()).map((item) => ({ ...item, texto: item.texto.trim() })),
      storyPoints: $("#pontos-tarefa").value || null,
      sprintId: $("#sprint-tarefa").value || null,
      criteriosAceitacao: $("#criterios-tarefa").value,
      definitionOfDone: $("#dod-tarefa").value
    };
    await salvarTarefa(boardId, dados, taskId, {
      tipo: "TAREFA_EDITADA",
      descricao: `Tarefa atualizada: ${titulo}`
    });
    tarefaAtual = { ...tarefaAtual, ...dados };
    informar("Alterações salvas.");
  } catch (falha) {
    console.error("Não foi possível salvar a tarefa.", falha);
    erro.textContent = falha.message || "Não foi possível salvar as alterações.";
    erro.classList.add("visivel");
    informar("Falha ao salvar.", true);
  } finally {
    botao.disabled = false;
  }
});

$("#formulario-comentario").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const botao = $("#enviar-comentario");
  botao.disabled = true;
  try {
    const texto = $("#texto-comentario").value.trim();
    await adicionarComentario(boardId, taskId, texto, {
      tipo: "COMENTARIO_ADICIONADO",
      descricao: `Comentário adicionado em: ${tarefaAtual.titulo}`
    });
    $("#texto-comentario").value = "";
    await carregarComentarios();
    informar("Comentário enviado.");
  } catch (erro) {
    console.error("Não foi possível salvar o comentário.", erro);
    informar(erro.message || "Não foi possível salvar o comentário.", true);
  } finally {
    botao.disabled = papel === "VIEWER";
  }
});

onAuthStateChanged(auth, (usuario) => {
  if (!usuario) {
    pararMonitoramentoMembro?.();
    pararMonitoramentoMembro = null;
    $("#conteudo-tarefa").hidden = true;
    $("#link-quadro").href = `./index.html?returnTo=${encodeURIComponent(location.href)}`;
    informar("Entre no Kanban com a conta que tem acesso ao quadro.", true);
    return;
  }
  carregar(usuario).catch((erro) => {
    console.error("Não foi possível carregar a tarefa.", erro);
    informar("Não foi possível acessar a tarefa. Confirme as regras do Firestore e o convite.", true);
  });
});
