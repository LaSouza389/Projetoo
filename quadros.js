import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

const COLUNAS_INICIAIS = [
  { id: "a-fazer", nome: "A Fazer", limiteWip: 0 },
  { id: "em-andamento", nome: "Em Andamento", limiteWip: 0 },
  { id: "concluido", nome: "Concluído", limiteWip: 0 }
];
const STATUS_SPRINT = ["PLANEJADA", "ATIVA", "CONCLUIDA"];

function usuarioObrigatorio() {
  if (!auth.currentUser) throw new Error("Você precisa estar logado.");
  return auth.currentUser;
}

function validarBoardId(boardId) {
  if (typeof boardId !== "string" || !boardId.trim() || boardId.includes("/")) {
    throw new Error("Identificador de quadro inválido.");
  }
}

function validarTexto(valor, rotulo, maximo = 200) {
  if (typeof valor !== "string" || !valor.trim() || valor.trim().length > maximo) {
    throw new Error(`${rotulo} deve ter entre 1 e ${maximo} caracteres.`);
  }
  return valor.trim();
}

function membroRef(boardId, uid) {
  return doc(db, "quadros", boardId, "membros", uid);
}

function anexarAtividade(lote, boardId, atividade) {
  if (!atividade) return;
  const usuario = usuarioObrigatorio();
  const referencia = doc(collection(db, "quadros", boardId, "historico"));
  lote.set(referencia, {
    tipo: validarTexto(atividade.tipo, "O tipo da atividade", 40),
    descricao: validarTexto(atividade.descricao, "A descrição da atividade", 300),
    taskId: atividade.taskId ?? null,
    autorId: usuario.uid,
    autorEmail: usuario.email ?? "",
    criadoEm: serverTimestamp()
  });
}

export async function criarQuadro(nome) {
  const usuario = usuarioObrigatorio();
  const nomeValido = validarTexto(nome, "O nome do quadro", 80);
  const quadroRef = doc(collection(db, "quadros"));
  const lote = writeBatch(db);
  lote.set(quadroRef, {
    nome: nomeValido,
    donoId: usuario.uid,
    colunas: COLUNAS_INICIAIS,
    criadoEm: serverTimestamp(),
    atualizadoEm: serverTimestamp()
  });
  lote.set(membroRef(quadroRef.id, usuario.uid), {
    userId: usuario.uid,
    email: usuario.email ?? "",
    papel: "OWNER"
  });
  await lote.commit();
  return quadroRef.id;
}

export async function listarMeusQuadros() {
  const usuario = usuarioObrigatorio();
  const consulta = query(
    collectionGroup(db, "membros"),
    where("userId", "==", usuario.uid)
  );
  const membros = await getDocs(consulta);
  const quadros = await Promise.all(membros.docs.map(async (membro) => {
    const boardId = membro.ref.parent.parent?.id;
    if (!boardId) return null;
    const quadro = await getDoc(doc(db, "quadros", boardId));
    if (!quadro.exists()) return null;
    if (quadro.data().migracaoStatus === "EM_ANDAMENTO") return null;
    return { id: boardId, ...quadro.data(), papel: membro.data().papel };
  }));
  return quadros.filter(Boolean).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export async function listarConvites() {
  const usuario = usuarioObrigatorio();
  if (!usuario.email) throw new Error("Sua conta não possui um e-mail verificado.");
  const consulta = query(
    collection(db, "convites"),
    where("email", "==", usuario.email.toLowerCase()),
    where("status", "==", "PENDENTE")
  );
  const resultado = await getDocs(consulta);
  return resultado.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function convidarUsuario(boardId, email, papel) {
  const usuario = usuarioObrigatorio();
  validarBoardId(boardId);
  const emailNormalizado = validarTexto(email, "O e-mail", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNormalizado)) {
    throw new Error("Informe um e-mail válido.");
  }
  if (!["EDITOR", "VIEWER"].includes(papel)) throw new Error("Permissão inválida.");
  const board = await getDoc(doc(db, "quadros", boardId));
  const membro = await getDoc(membroRef(boardId, usuario.uid));
  if (!board.exists() || !membro.exists() || membro.data().papel !== "OWNER") {
    throw new Error("Somente o proprietário pode convidar pessoas.");
  }
  if (board.data().donoId === usuario.uid && emailNormalizado === usuario.email?.toLowerCase()) {
    throw new Error("O proprietário já participa deste quadro.");
  }
  const existente = await getDocs(query(
    collection(db, "quadros", boardId, "membros"),
    where("email", "==", emailNormalizado)
  ));
  if (!existente.empty) throw new Error("Este usuário já participa do quadro.");
  const conviteRef = doc(collection(db, "convites"));
  const lote = writeBatch(db);
  lote.set(conviteRef, {
    boardId,
    boardNome: board.data().nome,
    email: emailNormalizado,
    papel,
    status: "PENDENTE",
    convidadoPor: usuario.uid,
    criadoEm: serverTimestamp()
  });
  anexarAtividade(lote, boardId, {
    tipo: "CONVITE_CRIADO",
    descricao: `Convite criado para ${emailNormalizado} como ${papel}`
  });
  await lote.commit();
}

export async function aceitarConvite(conviteId) {
  const usuario = usuarioObrigatorio();
  if (!usuario.email) throw new Error("Sua conta não possui um e-mail.");
  if (!usuario.emailVerified) throw new Error("Verifique seu e-mail antes de aceitar convites.");
  const conviteRef = doc(db, "convites", conviteId);
  await runTransaction(db, async (transacao) => {
    const conviteSnap = await transacao.get(conviteRef);
    if (!conviteSnap.exists()) throw new Error("Convite não encontrado.");
    const convite = conviteSnap.data();
    if (convite.email !== usuario.email.toLowerCase()) {
      throw new Error("Este convite foi enviado para outro e-mail.");
    }
    if (convite.status !== "PENDENTE") throw new Error("Este convite não está mais disponível.");
    if (!["EDITOR", "VIEWER"].includes(convite.papel) || !convite.boardId) {
      throw new Error("O convite contém dados inválidos.");
    }
    const membro = membroRef(convite.boardId, usuario.uid);
    transacao.set(membro, {
      userId: usuario.uid,
      email: usuario.email.toLowerCase(),
      papel: convite.papel,
      conviteId
    });
    transacao.update(conviteRef, {
      status: "ACEITO",
      aceitoPor: usuario.uid,
      aceitoEm: serverTimestamp()
    });
  });
}

export async function listarMembros(boardId) {
  validarBoardId(boardId);
  const resultado = await getDocs(collection(db, "quadros", boardId, "membros"));
  return resultado.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function removerMembro(boardId, membroId, atividade = null) {
  const usuario = usuarioObrigatorio();
  validarBoardId(boardId);
  if (membroId === usuario.uid) throw new Error("O proprietário não pode remover a si mesmo.");
  const board = await getDoc(doc(db, "quadros", boardId));
  if (!board.exists() || board.data().donoId !== usuario.uid) {
    throw new Error("Somente o proprietário pode remover participantes.");
  }
  const alvo = await getDoc(membroRef(boardId, membroId));
  if (!alvo.exists()) throw new Error("Participante não encontrado.");
  if (alvo.data().papel === "OWNER") throw new Error("Não é possível remover o proprietário.");
  const lote = writeBatch(db);
  lote.delete(membroRef(boardId, membroId));
  anexarAtividade(lote, boardId, atividade);
  await lote.commit();
}

export async function atualizarQuadro(boardId, dados) {
  validarBoardId(boardId);
  const atualizacao = { atualizadoEm: serverTimestamp() };
  if (dados.nome !== undefined) atualizacao.nome = validarTexto(dados.nome, "O nome do quadro", 80);
  if (dados.colunas !== undefined) {
    if (!Array.isArray(dados.colunas) || dados.colunas.length < 2 || dados.colunas.length > 8) {
      throw new Error("O quadro deve ter de 2 a 8 colunas.");
    }
    const ids = new Set();
    atualizacao.colunas = dados.colunas.map((coluna) => {
      const id = validarTexto(coluna.id, "O identificador da coluna", 40);
      if (id === "backlog") throw new Error("O identificador 'backlog' é reservado para a área de backlog.");
      if (ids.has(id)) throw new Error("Os identificadores das colunas devem ser únicos.");
      ids.add(id);
      const limiteWip = Number(coluna.limiteWip ?? 0);
      if (!Number.isInteger(limiteWip) || limiteWip < 0 || limiteWip > 999) {
        throw new Error("O limite WIP deve ser 0 (sem limite) ou um inteiro positivo.");
      }
      return { id, nome: validarTexto(coluna.nome, "O nome da coluna", 40), limiteWip };
    });
  }
  const lote = writeBatch(db);
  lote.update(doc(db, "quadros", boardId), atualizacao);
  anexarAtividade(lote, boardId, dados.atividade);
  await lote.commit();
}

export async function listarTarefas(boardId) {
  validarBoardId(boardId);
  const resultado = await getDocs(collection(db, "quadros", boardId, "tarefas"));
  return resultado.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export function escutarTarefas(boardId, aoAtualizar, aoErro) {
  validarBoardId(boardId);
  return onSnapshot(collection(db, "quadros", boardId, "tarefas"), (snapshot) => {
    aoAtualizar(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
  }, aoErro);
}

export async function salvarTarefa(boardId, tarefa, taskId = null, atividade = null) {
  const usuario = usuarioObrigatorio();
  validarBoardId(boardId);
  const titulo = validarTexto(tarefa.titulo, "O título da tarefa", 120);
  const boardSnap = await getDoc(doc(db, "quadros", boardId));
  if (!boardSnap.exists()) throw new Error("O quadro não foi encontrado.");
  const colunaDestino = String(tarefa.coluna ?? "");
  const colunaConfig = (boardSnap.data().colunas || []).find((item) => item.id === colunaDestino);
  if (colunaConfig?.limiteWip > 0) {
    const atuais = await getDocs(collection(db, "quadros", boardId, "tarefas"));
    const tarefaAtual = taskId ? atuais.docs.find((item) => item.id === taskId)?.data() : null;
    if (!tarefaAtual || tarefaAtual.coluna !== colunaDestino) {
      const contagem = atuais.docs.filter((item) => item.data().coluna === colunaDestino).length;
      if (contagem >= colunaConfig.limiteWip) {
        throw new Error(`O limite WIP da coluna "${colunaConfig.nome}" foi atingido.`);
      }
    }
  }
  if (!Array.isArray(tarefa.labels) || !Array.isArray(tarefa.checklist)) {
    throw new Error("Etiquetas e checklist precisam estar em formato de lista.");
  }
  const dueDate = tarefa.prazo ? new Date(`${tarefa.prazo}T00:00:00`) : null;
  if (dueDate && Number.isNaN(dueDate.getTime())) throw new Error("Prazo inválido.");
  const campos = {
    titulo,
    descricao: String(tarefa.descricao ?? "").trim().slice(0, 4000),
    coluna: validarTexto(tarefa.coluna, "A coluna", 40),
    responsavelId: tarefa.responsavelId || null,
    prazo: tarefa.prazo || null,
    prioridade: ["BAIXA", "MEDIA", "ALTA"].includes(tarefa.prioridade) ? tarefa.prioridade : "MEDIA",
    labels: tarefa.labels.map((label) => validarTexto(label, "A etiqueta", 30)).slice(0, 20),
    checklist: tarefa.checklist.slice(0, 50).map((item) => ({
      id: validarTexto(item.id, "O identificador da subtarefa", 80),
      texto: validarTexto(item.texto, "A subtarefa", 200),
      concluida: Boolean(item.concluida)
    })),
    storyPoints: tarefa.storyPoints === "" || tarefa.storyPoints == null ? null : Number(tarefa.storyPoints),
    sprintId: tarefa.sprintId || null,
    criteriosAceitacao: String(tarefa.criteriosAceitacao ?? "").trim().slice(0, 4000),
    definitionOfDone: String(tarefa.definitionOfDone ?? "").trim().slice(0, 4000),
    atualizadoPor: usuario.uid,
    atualizadoEm: serverTimestamp()
  };
  if (campos.storyPoints !== null && (!Number.isInteger(campos.storyPoints) || campos.storyPoints < 0 || campos.storyPoints > 100)) {
    throw new Error("Story Points deve ser um inteiro entre 0 e 100.");
  }
  if (!taskId) {
    campos.criadoPor = usuario.uid;
    campos.criadoEm = serverTimestamp();
    campos.comentariosCount = 0;
    const referencia = doc(collection(db, "quadros", boardId, "tarefas"));
    const lote = writeBatch(db);
    lote.set(referencia, campos);
    anexarAtividade(lote, boardId, atividade ? { ...atividade, taskId: referencia.id } : null);
    await lote.commit();
    return referencia.id;
  }
  const lote = writeBatch(db);
  lote.update(doc(db, "quadros", boardId, "tarefas", taskId), campos);
  anexarAtividade(lote, boardId, atividade ? { ...atividade, taskId } : null);
  await lote.commit();
  return taskId;
}

export async function excluirTarefa(boardId, taskId, atividade = null) {
  validarBoardId(boardId);
  const lote = writeBatch(db);
  lote.delete(doc(db, "quadros", boardId, "tarefas", taskId));
  anexarAtividade(lote, boardId, atividade ? { ...atividade, taskId } : null);
  await lote.commit();
}

export async function listarComentarios(boardId, taskId) {
  const resultado = await getDocs(collection(db, "quadros", boardId, "tarefas", taskId, "comentarios"));
  return resultado.docs.map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => (a.criadoEm?.seconds ?? 0) - (b.criadoEm?.seconds ?? 0));
}

export async function adicionarComentario(boardId, taskId, texto, atividade = null) {
  const usuario = usuarioObrigatorio();
  const mensagem = validarTexto(texto, "O comentário", 2000);
  validarBoardId(boardId);
  const tarefaRef = doc(db, "quadros", boardId, "tarefas", taskId);
  const tarefa = await getDoc(tarefaRef);
  if (!tarefa.exists()) throw new Error("A tarefa não existe mais.");
  const lote = writeBatch(db);
  const comentarioRef = doc(collection(db, "quadros", boardId, "tarefas", taskId, "comentarios"));
  lote.set(comentarioRef, {
    texto: mensagem,
    autorId: usuario.uid,
    autorEmail: usuario.email ?? "",
    criadoEm: serverTimestamp()
  });
  anexarAtividade(lote, boardId, atividade ? { ...atividade, taskId } : null);
  await lote.commit();
}

export async function listarSprints(boardId) {
  const resultado = await getDocs(collection(db, "quadros", boardId, "sprints"));
  return resultado.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function salvarSprint(boardId, sprint, sprintId = null, atividade = null) {
  validarBoardId(boardId);
  const nome = validarTexto(sprint.nome, "O nome da sprint", 80);
  if (!STATUS_SPRINT.includes(sprint.status)) throw new Error("Status de sprint inválido.");
  const inicio = sprint.inicio || null;
  const fim = sprint.fim || null;
  if (inicio && fim && fim < inicio) throw new Error("O fim da sprint não pode ser anterior ao início.");
  const dados = { nome, objetivo: String(sprint.objetivo ?? "").trim().slice(0, 1000), inicio, fim, status: sprint.status, atualizadoEm: serverTimestamp() };
  const lote = writeBatch(db);
  if (sprintId) {
    lote.update(doc(db, "quadros", boardId, "sprints", sprintId), dados);
  } else {
    lote.set(doc(collection(db, "quadros", boardId, "sprints")), { ...dados, criadoEm: serverTimestamp() });
  }
  anexarAtividade(lote, boardId, atividade);
  await lote.commit();
}

export async function excluirSprint(boardId, sprintId, atividade = null) {
  validarBoardId(boardId);
  const lote = writeBatch(db);
  lote.delete(doc(db, "quadros", boardId, "sprints", sprintId));
  anexarAtividade(lote, boardId, atividade);
  await lote.commit();
}

export async function listarHistorico(boardId) {
  const resultado = await getDocs(collection(db, "quadros", boardId, "historico"));
  return resultado.docs.map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => (b.criadoEm?.seconds ?? 0) - (a.criadoEm?.seconds ?? 0))
    .slice(0, 100);
}

function idLegadoSeguro(id) {
  return `legado-${encodeURIComponent(String(id)).replaceAll("/", "%2F")}`;
}

function serializarEstavel(valor) {
  if (valor === null || typeof valor !== "object") return JSON.stringify(valor) ?? "undefined";
  if (valor instanceof Date) return `{"$date":${JSON.stringify(valor.toISOString())}}`;
  if (Number.isInteger(valor.seconds) && Number.isInteger(valor.nanoseconds)) {
    return `{"$timestamp":[${valor.seconds},${valor.nanoseconds}]}`;
  }
  if (Array.isArray(valor)) return `[${valor.map(serializarEstavel).join(",")}]`;
  return `{${Object.keys(valor).sort().map((chave) =>
    `${JSON.stringify(chave)}:${serializarEstavel(valor[chave])}`
  ).join(",")}}`;
}

function tarefaLegadaCorresponde(snapshot, atividade) {
  if (!snapshot.exists()) return false;
  const dados = snapshot.data();
  const coluna = COLUNAS_INICIAIS.some((item) => item.id === atividade.coluna)
    ? atividade.coluna
    : "a-fazer";
  return dados.legadoId === atividade.id
    && serializarEstavel(dados.dadosLegados) === serializarEstavel(atividade)
    && dados.titulo === atividade.titulo.slice(0, 120)
    && dados.descricao === (typeof atividade.descricao === "string" ? atividade.descricao.slice(0, 4000) : "")
    && dados.coluna === coluna;
}

async function validarTarefasMigradas(boardId, tarefas) {
  for (let inicio = 0; inicio < tarefas.length; inicio += 200) {
    const grupo = tarefas.slice(inicio, inicio + 200);
    const snapshots = await Promise.all(grupo.map((atividade) =>
      getDoc(doc(db, "quadros", boardId, "tarefas", idLegadoSeguro(atividade.id)))
    ));
    snapshots.forEach((snapshot, indice) => {
      if (!tarefaLegadaCorresponde(snapshot, grupo[indice])) {
        throw new Error(`A tarefa migrada "${grupo[indice].titulo}" está ausente ou diverge do legado. A migração não foi concluída.`);
      }
    });
  }
}

export async function migrarQuadroLegado() {
  const usuario = usuarioObrigatorio();
  const legadoRef = doc(db, "quadros", usuario.uid);
  const legadoSnap = await getDoc(legadoRef);
  if (!legadoSnap.exists()) return { status: "nao-encontrado" };
  const legado = legadoSnap.data();
  if (!Array.isArray(legado.atividades)) throw new Error("O documento antigo não contém uma lista de atividades válida.");
  const tarefas = legado.atividades;
  const idsLegados = new Set();
  for (const atividade of tarefas) {
    if (!atividade || typeof atividade.id !== "string" || !atividade.id || typeof atividade.titulo !== "string" || !atividade.titulo.trim()) {
      throw new Error("Há uma atividade antiga sem identificador ou título; nenhum dado foi alterado.");
    }
    let taskId;
    try {
      taskId = idLegadoSeguro(atividade.id);
    } catch {
      throw new Error("Uma atividade possui identificador inválido; nenhum dado foi alterado.");
    }
    if (taskId.length > 1000 || idsLegados.has(taskId)) {
      throw new Error("Há identificadores de atividades repetidos ou muito longos; nenhum dado foi alterado.");
    }
    idsLegados.add(taskId);
  }
  const boardId = `legado-${usuario.uid}`;
  const assinaturaOrigem = serializarEstavel(tarefas);
  if (legado.migracaoColaborativa?.status === "CONCLUIDA") {
    if (legado.migracaoColaborativa.boardId !== boardId) {
      throw new Error("O marcador de migração aponta para um quadro inesperado.");
    }
    const quadroConcluido = await getDoc(doc(db, "quadros", boardId));
    if (!quadroConcluido.exists()
      || quadroConcluido.data().migracaoOrigem !== usuario.uid
      || quadroConcluido.data().migracaoStatus !== "CONCLUIDA") {
      throw new Error("O marcador antigo indica conclusão, mas o quadro migrado não está consistente.");
    }
    await validarTarefasMigradas(boardId, tarefas);
    return { status: "ja-concluida", boardId };
  }
  const boardRef = doc(db, "quadros", boardId);
  const boardSnap = await getDoc(boardRef);
  if (boardSnap.exists() && boardSnap.data().migracaoOrigem !== usuario.uid) {
    throw new Error("O identificador de migração já está ocupado; nenhum dado foi alterado.");
  }
  if (!boardSnap.exists()) {
    const loteInicial = writeBatch(db);
    loteInicial.set(boardRef, {
      nome: "Meu quadro (migrado)",
      donoId: usuario.uid,
      colunas: COLUNAS_INICIAIS,
      migracaoOrigem: usuario.uid,
      migracaoStatus: "EM_ANDAMENTO",
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    });
    loteInicial.set(membroRef(boardId, usuario.uid), {
      userId: usuario.uid,
      email: usuario.email ?? "",
      papel: "OWNER"
    });
    await loteInicial.commit();
  }
  const membro = await getDoc(membroRef(boardId, usuario.uid));
  if (!membro.exists() || membro.data().papel !== "OWNER") {
    throw new Error("O quadro de migração não possui a participação de proprietário esperada.");
  }
  const statusQuadro = (await getDoc(boardRef)).data()?.migracaoStatus;
  if (!["EM_ANDAMENTO", "CONCLUIDA"].includes(statusQuadro)) {
    throw new Error("O quadro de migração está em um estado inconsistente.");
  }
  for (let inicio = 0; inicio < tarefas.length; inicio += 200) {
    const grupo = tarefas.slice(inicio, inicio + 200);
    const referencias = grupo.map((atividade) =>
      doc(db, "quadros", boardId, "tarefas", idLegadoSeguro(atividade.id))
    );
    await runTransaction(db, async (transacao) => {
      const snapshots = await Promise.all(referencias.map((referencia) => transacao.get(referencia)));
      snapshots.forEach((snapshot, indice) => {
        const atividade = grupo[indice];
        if (snapshot.exists()) {
          if (!tarefaLegadaCorresponde(snapshot, atividade)) {
            throw new Error(`Já existe uma tarefa conflitante para "${atividade.titulo}". Nenhum dado existente foi sobrescrito.`);
          }
          return;
        }
        const coluna = COLUNAS_INICIAIS.some((item) => item.id === atividade.coluna) ? atividade.coluna : "a-fazer";
        transacao.set(referencias[indice], {
          titulo: atividade.titulo.slice(0, 120),
          descricao: typeof atividade.descricao === "string" ? atividade.descricao.slice(0, 4000) : "",
          coluna,
          responsavelId: null,
          prazo: null,
          prioridade: "MEDIA",
          labels: [],
          checklist: [],
          storyPoints: null,
          sprintId: null,
          criteriosAceitacao: "",
          definitionOfDone: "",
          legadoId: atividade.id,
          criadoPor: usuario.uid,
          atualizadoPor: usuario.uid,
          criadoEm: serverTimestamp(),
          atualizadoEm: serverTimestamp(),
          comentariosCount: 0,
          dadosLegados: atividade
        });
      });
    });
  }
  await validarTarefasMigradas(boardId, tarefas);
  const atividadeRef = doc(db, "quadros", boardId, "historico", `migracao-${usuario.uid}`);
  const finalizacao = await runTransaction(db, async (transacao) => {
    const referenciasTarefas = tarefas.map((atividade) =>
      doc(db, "quadros", boardId, "tarefas", idLegadoSeguro(atividade.id))
    );
    const [legadoAtual, quadroAtual, atividadeAtual, snapshotsTarefas] = await Promise.all([
      transacao.get(legadoRef),
      transacao.get(boardRef),
      transacao.get(atividadeRef),
      Promise.all(referenciasTarefas.map((referencia) => transacao.get(referencia)))
    ]);
    if (!legadoAtual.exists() || !quadroAtual.exists()) {
      throw new Error("Os documentos necessários para finalizar a migração não existem.");
    }
    const dadosLegadoAtual = legadoAtual.data();
    const dadosQuadroAtual = quadroAtual.data();
    if (!Array.isArray(dadosLegadoAtual.atividades)
      || serializarEstavel(dadosLegadoAtual.atividades) !== assinaturaOrigem) {
      throw new Error("As atividades antigas mudaram durante a migração. Revise os dados e tente novamente.");
    }
    if (dadosQuadroAtual.migracaoOrigem !== usuario.uid
      || dadosQuadroAtual.donoId !== usuario.uid
      || !["EM_ANDAMENTO", "CONCLUIDA"].includes(dadosQuadroAtual.migracaoStatus)) {
      throw new Error("O quadro de migração mudou de proprietário ou estado.");
    }
    snapshotsTarefas.forEach((snapshot, indice) => {
      if (!tarefaLegadaCorresponde(snapshot, tarefas[indice])) {
        throw new Error(`A tarefa migrada "${tarefas[indice].titulo}" está ausente ou diverge do legado. A migração não foi concluída.`);
      }
    });
    const marcadorConcluido = dadosLegadoAtual.migracaoColaborativa?.status === "CONCLUIDA";
    if (marcadorConcluido && dadosLegadoAtual.migracaoColaborativa.boardId !== boardId) {
      throw new Error("O documento antigo já aponta para outro quadro migrado.");
    }
    if (dadosQuadroAtual.migracaoStatus === "EM_ANDAMENTO") {
      transacao.update(boardRef, {
        migracaoStatus: "CONCLUIDA",
        atualizadoEm: serverTimestamp()
      });
    }
    if (!marcadorConcluido) {
      transacao.update(legadoRef, {
        migracaoColaborativa: { status: "CONCLUIDA", boardId, concluidaEm: serverTimestamp() }
      });
    }
    if (!atividadeAtual.exists()) {
      transacao.set(atividadeRef, {
        tipo: "MIGRACAO_CONCLUIDA",
        descricao: `Migração concluída: ${tarefas.length} tarefa(s) copiadas`,
        taskId: null,
        autorId: usuario.uid,
        autorEmail: usuario.email ?? "",
        criadoEm: serverTimestamp()
      });
    }
    return marcadorConcluido ? "ja-concluida" : "concluida";
  });
  return { status: finalizacao, boardId, total: tarefas.length };
}
