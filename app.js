// ============================================================
// PORTAL RE/MAX SPACE — Inquilino & Proprietário
// ============================================================

var SUPA_URL = 'https://pokgfnlywtgubpuswmni.supabase.co';
var SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBva2dmbmx5d3RndWJwdXN3bW5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1OTYwNzgsImV4cCI6MjA5NTE3MjA3OH0.wK2qG14wMA7FVnVT0NKEbbLZyAIZkSahsChRivgd-Ko';

var _sb = null;
function getSB(){
  if(!_sb && window.supabase){ _sb = supabase.createClient(SUPA_URL, SUPA_KEY); }
  return _sb;
}

// Dados carregados do app principal (mesma estrutura do remax-app)
var APPDATA = { ct: [], boletos: [], hist: {} };

// Sessão atual
var SESSAO = null; // {tipo:'inquilino'|'proprietario', nome, contratos:[...]}
var TIPO_LOGIN = 'inquilino';
var TELA_ATUAL = 'home';

// ===== PIX (mesma config do app principal) =====
var CHAVE_PIX = '+5511969197881';
var NOME_PIX = 'REMAX Space';
var CIDADE_PIX = 'Caldas Novas';

function gerarPixPayload(valor, txid, desc){
  txid = (txid||'REMAXSPACE').replace(/[^A-Za-z0-9]/g,'').slice(0,25)||'REMAXSPACE';
  desc = (desc||'Aluguel').replace(/[^a-zA-Z0-9 ]/g,'').slice(0,25);
  var val = parseFloat(valor).toFixed(2);
  function tlv(tag,v){ var s=String(v); return tag+('0'+s.length).slice(-2)+s; }
  var merchant = tlv('00','BR.GOV.BCB.PIX')+tlv('01',CHAVE_PIX)+tlv('02',desc);
  var payload = tlv('00','01')+tlv('26',merchant)+tlv('52','0000')+tlv('53','986')+tlv('54',val)+tlv('58','BR')+tlv('59',NOME_PIX.slice(0,25))+tlv('60',CIDADE_PIX.slice(0,15))+tlv('62',tlv('05',txid))+'6304';
  var crc=0xFFFF;
  for(var i=0;i<payload.length;i++){
    crc^=payload.charCodeAt(i)<<8;
    for(var j=0;j<8;j++){ crc=(crc&0x8000)?((crc<<1)^0x1021)&0xFFFF:(crc<<1)&0xFFFF; }
  }
  return payload+('0000'+crc.toString(16).toUpperCase()).slice(-4);
}
function gerarQrCodePix(valor, txid, desc){
  return 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data='+encodeURIComponent(gerarPixPayload(valor,txid,desc));
}

// ===== Encargos (multa + juros) =====
function calcularEncargos(valor, venc, mesRef){
  // mesRef tipo "Junho de 2026"
  var meses = {'Janeiro':0,'Fevereiro':1,'Março':2,'Abril':3,'Maio':4,'Junho':5,'Julho':6,'Agosto':7,'Setembro':8,'Outubro':9,'Novembro':10,'Dezembro':11};
  var partes = (mesRef||'').split(' de ');
  var mIdx = meses[partes[0]];
  var ano = parseInt(partes[1])||new Date().getFullYear();
  var dataVenc = new Date(ano, mIdx, venc);
  var hoje = new Date();
  hoje.setHours(0,0,0,0);
  dataVenc.setHours(0,0,0,0);
  var diasAtraso = Math.floor((hoje - dataVenc)/(1000*60*60*24));
  if(diasAtraso < 0) diasAtraso = 0;
  var multa = diasAtraso>0 ? valor*0.10 : 0;
  var juros = diasAtraso>0 ? valor*0.01*(diasAtraso/30) : 0;
  var total = valor + multa + juros;
  return {diasAtraso:diasAtraso, multa:multa, juros:juros, total:total};
}

function fmt(v){
  return 'R$ '+ (v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
}

// ===== Carregar dados do Supabase =====
async function carregarDados(){
  try{
    var sb = getSB();
    if(!sb) throw new Error('Supabase não disponível');
    var res = await sb.from('app_state').select('data').eq('id','remax_space_main').single();
    if(res.error) throw res.error;
    var raw = res.data && res.data.data;
    if(!raw) throw new Error('Dados vazios');
    var e = (typeof raw === 'string') ? JSON.parse(raw) : raw;
    APPDATA.ct = e.ct || [];
    APPDATA.boletos = e.bl || [];
    APPDATA.hist = e.hi || {};
    APPDATA.props = e.pc || [];
    return true;
  }catch(err){
    console.error('Erro ao carregar dados:', err);
    return false;
  }
}

// ===== Helpers de busca =====
function limparCPF(cpf){
  return (cpf||'').replace(/[^0-9]/g,'');
}

function buscarInquilino(cpf, nasc){
  var cpfLimpo = limparCPF(cpf);
  for(var i=0;i<APPDATA.ct.length;i++){
    var c = APPDATA.ct[i];
    if(limparCPF(c.cpf_inq) === cpfLimpo && c.nasc_inq === nasc){
      return c;
    }
  }
  return null;
}

function buscarProprietario(cpf, nasc){
  var cpfLimpo = limparCPF(cpf);
  // Buscar na lista de proprietários (props) e retornar todos os contratos dele
  if(!APPDATA.props) return null;
  for(var i=0;i<APPDATA.props.length;i++){
    var p = APPDATA.props[i];
    if(limparCPF(p.cpf) === cpfLimpo && p.nasc === nasc){
      var contratos = APPDATA.ct.filter(function(c){ return c.prop === p.nome; });
      return {prop: p, contratos: contratos};
    }
  }
  return null;
}

// ===== LOGIN =====
function setTipo(tipo){
  TIPO_LOGIN = tipo;
  document.getElementById('tab-inq').classList.toggle('active', tipo==='inquilino');
  document.getElementById('tab-prop').classList.toggle('active', tipo==='proprietario');
  document.getElementById('login-title').textContent = tipo==='inquilino' ? 'Acesso do Inquilino' : 'Acesso do Proprietário';
  document.getElementById('login-err').style.display = 'none';
}

async function doLogin(){
  var cpf = document.getElementById('login-cpf').value;
  var nasc = document.getElementById('login-nasc').value;
  var err = document.getElementById('login-err');
  var btn = document.getElementById('btn-login');
  err.style.display = 'none';

  if(!limparCPF(cpf) || limparCPF(cpf).length < 11){
    err.textContent = 'Digite um CPF válido.';
    err.style.display = 'block';
    return;
  }
  if(!nasc){
    err.textContent = 'Informe sua data de nascimento.';
    err.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Verificando...';

  var ok = await carregarDados();
  if(!ok){
    err.textContent = 'Não foi possível conectar. Tente novamente em alguns segundos.';
    err.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Entrar';
    return;
  }

  if(TIPO_LOGIN === 'inquilino'){
    var contrato = buscarInquilino(cpf, nasc);
    if(!contrato){
      err.textContent = 'CPF ou data de nascimento não encontrados. Verifique os dados ou fale com a RE/MAX Space.';
      err.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Entrar';
      return;
    }
    SESSAO = {tipo:'inquilino', nome: contrato.inq, contrato: contrato};
  } else {
    var res = buscarProprietario(cpf, nasc);
    if(!res){
      err.textContent = 'CPF ou data de nascimento não encontrados. Verifique os dados ou fale com a RE/MAX Space.';
      err.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Entrar';
      return;
    }
    SESSAO = {tipo:'proprietario', nome: res.prop.nome, prop: res.prop, contratos: res.contratos};
  }

  // Salvar sessão (sessionStorage - não persiste entre abas/fechamento)
  try{ sessionStorage.setItem('_remaxPortalSessao', JSON.stringify(SESSAO)); }catch(e){}

  entrarApp();
}

function doLogout(){
  SESSAO = null;
  try{ sessionStorage.removeItem('_remaxPortalSessao'); }catch(e){}
  document.getElementById('app-screen').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-cpf').value = '';
  document.getElementById('login-nasc').value = '';
}

// ===== Formatação CPF input =====
document.addEventListener('DOMContentLoaded', function(){
  var cpfInput = document.getElementById('login-cpf');
  if(cpfInput){
    cpfInput.addEventListener('input', function(){
      var v = this.value.replace(/\D/g,'').slice(0,11);
      if(v.length > 9) v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
      else if(v.length > 6) v = v.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
      else if(v.length > 3) v = v.replace(/(\d{3})(\d{1,3})/, '$1.$2');
      this.value = v;
    });
  }

  init();
});

// ===== INIT =====
async function init(){
  // Tentar restaurar sessão
  try{
    var saved = sessionStorage.getItem('_remaxPortalSessao');
    if(saved){
      SESSAO = JSON.parse(saved);
      await carregarDados();
      // Re-vincular contrato/prop atualizados
      if(SESSAO.tipo === 'inquilino' && SESSAO.contrato){
        var atual = APPDATA.ct.find(function(c){return c.id === SESSAO.contrato.id;});
        if(atual) SESSAO.contrato = atual;
      } else if(SESSAO.tipo === 'proprietario' && SESSAO.prop){
        SESSAO.contratos = APPDATA.ct.filter(function(c){return c.prop === SESSAO.prop.nome;});
      }
      entrarApp();
      return;
    }
  }catch(e){ console.warn(e); }

  document.getElementById('loading-screen').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
}

// ===== ENTRAR NO APP =====
function entrarApp(){
  document.getElementById('loading-screen').style.display = 'none';
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'block';

  var sub = SESSAO.tipo === 'inquilino' ? 'Portal do Inquilino' : 'Portal do Proprietário';
  document.getElementById('topbar-sub').textContent = sub;

  renderNav();
  renderTela('home');
}

// ===== NAVEGAÇÃO =====
function renderNav(){
  var nav = document.getElementById('bottomnav');
  var items;
  if(SESSAO.tipo === 'inquilino'){
    items = [
      {id:'home', ic:'🏠', lbl:'Início'},
      {id:'boletos', ic:'🧾', lbl:'Boletos'},
      {id:'contrato', ic:'📄', lbl:'Contrato'},
      {id:'vistoria', ic:'🔍', lbl:'Vistoria'}
    ];
  } else {
    items = [
      {id:'home', ic:'🏠', lbl:'Início'},
      {id:'extrato', ic:'📊', lbl:'Extrato'},
      {id:'imoveis', ic:'🏢', lbl:'Imóveis'},
      {id:'contratos', ic:'📄', lbl:'Contratos'}
    ];
  }
  nav.innerHTML = items.map(function(it){
    return '<button class="'+(TELA_ATUAL===it.id?'active':'')+'" onclick="renderTela(\''+it.id+'\')">'+
      '<span class="ic">'+it.ic+'</span>'+it.lbl+
    '</button>';
  }).join('');
}

function renderTela(tela){
  TELA_ATUAL = tela;
  renderNav();
  var c = document.getElementById('content');
  if(SESSAO.tipo === 'inquilino'){
    if(tela==='home') c.innerHTML = telaHomeInquilino();
    else if(tela==='boletos') c.innerHTML = telaBoletosInquilino();
    else if(tela==='contrato') c.innerHTML = telaContratoInquilino();
    else if(tela==='vistoria') c.innerHTML = telaVistoriaInquilino();
  } else {
    if(tela==='home') c.innerHTML = telaHomeProprietario();
    else if(tela==='extrato') c.innerHTML = telaExtratoProprietario();
    else if(tela==='imoveis') c.innerHTML = telaImoveisProprietario();
    else if(tela==='contratos') c.innerHTML = telaContratosProprietario();
  }
  c.scrollTop = 0;
}

// ============================================================
// TELAS — INQUILINO
// ============================================================
function telaHomeInquilino(){
  var c = SESSAO.contrato;
  var primeiroNome = (c.inq||'').split(' ')[0];
  var boletoAtual = APPDATA.boletos.find(function(b){ return b.ctId === c.id; });
  var html = '<div class="greeting"><h2>Olá, '+primeiroNome+' 👋</h2><p>Bem-vindo ao seu portal — '+c.id+'</p></div>';

  if(boletoAtual){
    var enc = calcularEncargos(boletoAtual.valor, c.venc, boletoAtual.mes);
    var statusTag = boletoAtual.status === 'Pago'
      ? '<span class="tag tag-pago">✓ Pago</span>'
      : enc.diasAtraso > 0 ? '<span class="tag tag-atraso">⚠️ '+enc.diasAtraso+' dia(s) em atraso</span>'
      : '<span class="tag tag-pendente">Pendente</span>';

    html += '<div class="card">'+
      '<h3>🧾 Boleto de '+boletoAtual.mes+'</h3>'+
      '<div style="text-align:center;background:linear-gradient(135deg,#f0fdf4,#dcfce7);border-radius:12px;padding:16px;margin-bottom:12px">'+
        '<div style="font-size:11px;color:var(--muted);font-weight:700">VALOR'+(enc.diasAtraso>0?' COM ENCARGOS':'')+'</div>'+
        '<div style="font-size:28px;font-weight:900;color:var(--azul-d)">'+fmt(enc.total)+'</div>'+
        '<div style="margin-top:6px">'+statusTag+'</div>'+
      '</div>'+
      (boletoAtual.status !== 'Pago' ? '<button class="btn btn-primary" onclick="abrirBoletoModal(\''+c.id+'\')">Ver Boleto e Pagar com PIX</button>' : '')+
    '</div>';
  }

  html += '<div class="kpi-row">'+
    '<div class="kpi"><div class="val">'+fmt(c.valor)+'</div><div class="lbl">Aluguel</div></div>'+
    '<div class="kpi"><div class="val">Dia '+c.venc+'</div><div class="lbl">Vencimento</div></div>'+
  '</div>';

  html += '<div class="card"><h3>🏠 Imóvel</h3>'+
    '<div class="row-list"><span class="l">Endereço</span><span class="v">'+(c.end||'-')+'</span></div>'+
    '<div class="row-list"><span class="l">Tipo</span><span class="v">'+(c.tipo||'-')+'</span></div>'+
    '<div class="row-list"><span class="l">Contrato</span><span class="v">'+c.id+'</span></div>'+
  '</div>';

  return html;
}

function telaBoletosInquilino(){
  var c = SESSAO.contrato;
  var meusBoletos = APPDATA.boletos.filter(function(b){ return b.ctId === c.id; });
  var html = '<div class="greeting"><h2>🧾 Boletos</h2><p>Histórico e 2ª via</p></div>';

  if(meusBoletos.length === 0){
    html += '<div class="empty"><div class="ic">📭</div><p>Nenhum boleto disponível ainda.</p></div>';
    return html;
  }

  html += '<div class="card">';
  meusBoletos.forEach(function(b){
    var enc = calcularEncargos(b.valor, c.venc, b.mes);
    var tag = b.status === 'Pago'
      ? '<span class="tag tag-pago">✓ Pago</span>'
      : enc.diasAtraso > 0 ? '<span class="tag tag-atraso">Em atraso</span>'
      : '<span class="tag tag-pendente">Pendente</span>';
    html += '<div class="boleto-item" onclick="abrirBoletoModal(\''+c.id+'\',\''+b.mes+'\')" style="cursor:pointer">'+
      '<div class="info"><div class="mes">'+b.mes+'</div><div class="venc">Venc: Dia '+c.venc+'</div>'+tag+'</div>'+
      '<div class="val">'+fmt(b.status==='Pago'?b.valor:enc.total)+'</div>'+
    '</div>';
  });
  html += '</div>';
  return html;
}

function telaContratoInquilino(){
  var c = SESSAO.contrato;
  var html = '<div class="greeting"><h2>📄 Meu Contrato</h2><p>'+c.id+'</p></div>';
  html += '<div class="card">'+
    '<div class="row-list"><span class="l">Proprietário</span><span class="v">'+c.prop+'</span></div>'+
    '<div class="row-list"><span class="l">Inquilino</span><span class="v">'+c.inq+'</span></div>'+
    '<div class="row-list"><span class="l">Imóvel</span><span class="v">'+c.tipo+'</span></div>'+
    '<div class="row-list"><span class="l">Endereço</span><span class="v" style="text-align:right;max-width:60%">'+c.end+'</span></div>'+
    '<div class="row-list"><span class="l">Valor do Aluguel</span><span class="v">'+fmt(c.valor)+'</span></div>'+
    '<div class="row-list"><span class="l">Dia de Vencimento</span><span class="v">'+c.venc+'</span></div>'+
    '<div class="row-list"><span class="l">Início</span><span class="v">'+formatarData(c.inicio)+'</span></div>'+
    '<div class="row-list"><span class="l">Fim</span><span class="v">'+formatarData(c.fim)+'</span></div>'+
    '<div class="row-list"><span class="l">Status</span><span class="v">'+c.status+'</span></div>'+
    '<div class="row-list"><span class="l">Corretor responsável</span><span class="v">'+(c.corretor||'-')+'</span></div>'+
  '</div>';
  html += '<div class="card" style="text-align:center;color:var(--muted);font-size:12px">'+
    '📎 Documento completo do contrato disponível na imobiliária. Em caso de dúvidas, entre em contato pelo WhatsApp.'+
  '</div>';
  return html;
}

function telaVistoriaInquilino(){
  var c = SESSAO.contrato;
  var html = '<div class="greeting"><h2>🔍 Vistoria</h2><p>Status da vistoria do imóvel</p></div>';
  html += '<div class="card">'+
    '<div class="row-list"><span class="l">Status</span><span class="v">'+(c.vistoria||'A conferir')+'</span></div>'+
    '<div class="row-list"><span class="l">Imóvel</span><span class="v">'+c.end+'</span></div>'+
  '</div>';
  html += '<div class="card" style="text-align:center;color:var(--muted);font-size:12px">'+
    '📋 Para solicitar uma vistoria ou reportar um problema no imóvel, entre em contato com a RE/MAX Space pelo WhatsApp.'+
  '</div>';
  return html;
}

// ============================================================
// MODAL DE BOLETO (Inquilino)
// ============================================================
function abrirBoletoModal(ctId, mes){
  var c = SESSAO.contrato;
  var boleto = APPDATA.boletos.find(function(b){
    return b.ctId === ctId && (!mes || b.mes === mes);
  });
  if(!boleto) return;

  var enc = calcularEncargos(boleto.valor, c.venc, boleto.mes);
  var txid = ('REMAX'+ctId.replace(/[^A-Z0-9]/g,'')).slice(0,25);
  var payload = gerarPixPayload(enc.total, txid, 'Aluguel');
  var qrUrl = gerarQrCodePix(enc.total, txid, 'Aluguel');
  window._pixPayloadAtual = payload;

  var encHtml = enc.diasAtraso > 0
    ? '<div style="background:#fef2f2;border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:#991b1b;font-weight:600">⚠️ '+enc.diasAtraso+' dia(s) de atraso<br>Multa (10%): +'+fmt(enc.multa)+' • Juros: +'+fmt(enc.juros)+'</div>'
    : '';

  var html = '<button class="modal-close" onclick="closeModal()">×</button>'+
    '<h3>Boleto — '+boleto.mes+'</h3>'+
    encHtml+
    '<div style="text-align:center;background:linear-gradient(135deg,#f0fdf4,#dcfce7);border-radius:12px;padding:16px;margin-bottom:16px">'+
      '<div style="font-size:11px;color:var(--muted);font-weight:700">VALOR A PAGAR</div>'+
      '<div style="font-size:30px;font-weight:900;color:var(--verde)">'+fmt(enc.total)+'</div>'+
      '<div style="font-size:11px;color:var(--muted);margin-top:2px">'+ctId+' • Venc: Dia '+c.venc+'</div>'+
    '</div>'+
    '<div style="text-align:center;margin-bottom:16px">'+
      '<img src="'+qrUrl+'" style="width:170px;height:170px;border:3px solid var(--border);border-radius:12px">'+
      '<div style="font-size:11px;color:var(--muted);margin-top:6px">Escaneie com o app do seu banco</div>'+
    '</div>'+
    '<div style="font-size:11px;font-weight:700;color:var(--azul-d);margin-bottom:6px">📋 PIX Copia e Cola:</div>'+
    '<div class="pix-codigo" id="pix-box-modal">'+payload+'</div>'+
    '<button class="btn-copy" id="btn-copy-modal" onclick="copiarPixModal()">📋 COPIAR CÓDIGO PIX</button>'+
    '<div class="copy-ok" id="pix-ok-modal">✅ Código copiado! Abra seu banco e cole.</div>'+
    '<button class="btn btn-primary" style="margin-top:12px;background:#0f1a35" onclick="imprimirBoletoModal(\''+ctId+'\',\''+boleto.mes+'\')">🖨️ Salvar / Imprimir PDF</button>';

  openModal(html);
}

function copiarPixModal(){
  var payload = window._pixPayloadAtual;
  if(!payload) return;
  var btn = document.getElementById('btn-copy-modal');
  var ok = document.getElementById('pix-ok-modal');
  function _ok(){
    btn.style.background = 'var(--verde)';
    btn.textContent = '✅ COPIADO! Cole no seu banco';
    ok.style.display = 'block';
    setTimeout(function(){ btn.style.background=''; btn.textContent='📋 COPIAR CÓDIGO PIX'; }, 4000);
  }
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(payload).then(_ok).catch(_fb);
  } else { _fb(); }
  function _fb(){
    var ta=document.createElement('textarea'); ta.value=payload;
    ta.style.cssText='position:fixed;opacity:0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta); _ok();
  }
}

function imprimirBoletoModal(ctId, mes){
  window.print();
}

// ============================================================
// TELAS — PROPRIETÁRIO
// ============================================================
function telaHomeProprietario(){
  var prop = SESSAO.prop;
  var contratos = SESSAO.contratos;
  var primeiroNome = (prop.nome||'').split(' ')[0];

  var totalMensal = contratos.reduce(function(s,c){ return s + (c.valor||0); }, 0);
  var totalRepasse = totalMensal * 0.90; // 10% taxa adm

  var html = '<div class="greeting"><h2>Olá, '+primeiroNome+' 👋</h2><p>Bem-vindo ao seu portal — '+contratos.length+' imóvel(eis)</p></div>';

  html += '<div class="kpi-row">'+
    '<div class="kpi"><div class="val">'+fmt(totalRepasse)+'</div><div class="lbl">Repasse Mensal</div></div>'+
    '<div class="kpi"><div class="val">'+contratos.length+'</div><div class="lbl">Imóveis Locados</div></div>'+
  '</div>';

  html += '<div class="card"><h3>🏢 Seus Imóveis</h3>';
  contratos.forEach(function(c){
    var statusTag = c.status === 'Ativa' ? '<span class="tag tag-pago">Ativo</span>' : '<span class="tag tag-pendente">'+c.status+'</span>';
    html += '<div class="boleto-item">'+
      '<div class="info"><div class="mes">'+(c.end||c.tipo)+'</div><div class="venc">'+c.id+' • '+c.tipo+'</div>'+statusTag+'</div>'+
      '<div class="val">'+fmt(c.valor*0.90)+'</div>'+
    '</div>';
  });
  html += '</div>';

  html += '<div class="card" style="text-align:center;color:var(--muted);font-size:12px">'+
    '💼 Taxa de administração: 10% sobre o valor do aluguel.'+
  '</div>';

  return html;
}

function telaExtratoProprietario(){
  var contratos = SESSAO.contratos;
  var html = '<div class="greeting"><h2>📊 Extrato de Repasses</h2><p>Histórico mensal</p></div>';

  contratos.forEach(function(c){
    var hist = APPDATA.hist[c.id] || [];
    var meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    var statusMap = {R:'Recebido',P:'Parcial',X:'Não pago',N:'Pendente'};
    var corMap = {R:'tag-pago',P:'tag-pendente',X:'tag-atraso',N:'tag-pendente'};

    html += '<div class="card"><h3>🏠 '+c.id+' — '+(c.end||c.tipo)+'</h3>';
    html += '<div class="row-list"><span class="l">Valor do aluguel</span><span class="v">'+fmt(c.valor)+'</span></div>';
    html += '<div class="row-list"><span class="l">Repasse (90%)</span><span class="v">'+fmt(c.valor*0.90)+'</span></div>';
    html += '<div style="margin-top:10px;font-size:12px;font-weight:700;color:var(--azul-d);margin-bottom:8px">Histórico '+new Date().getFullYear()+'</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">';
    for(var i=0;i<12;i++){
      var st = hist[i] || 'N';
      html += '<div style="text-align:center;border:1px solid var(--border);border-radius:6px;padding:6px 2px">'+
        '<div style="font-size:10px;color:var(--muted);font-weight:700">'+meses[i]+'</div>'+
        '<span class="tag '+corMap[st]+'" style="margin-top:2px;font-size:9px">'+statusMap[st]+'</span>'+
      '</div>';
    }
    html += '</div></div>';
  });

  html += '<div class="card" style="text-align:center">'+
    '<button class="btn btn-primary" onclick="window.print()">🖨️ Salvar Extrato em PDF</button>'+
  '</div>';

  return html;
}

function telaImoveisProprietario(){
  var contratos = SESSAO.contratos;
  var html = '<div class="greeting"><h2>🏢 Meus Imóveis</h2><p>'+contratos.length+' imóvel(eis) cadastrado(s)</p></div>';

  contratos.forEach(function(c){
    html += '<div class="card"><h3>'+(c.end||c.tipo)+'</h3>'+
      '<div class="row-list"><span class="l">Tipo</span><span class="v">'+c.tipo+'</span></div>'+
      '<div class="row-list"><span class="l">Inquilino</span><span class="v">'+c.inq+'</span></div>'+
      '<div class="row-list"><span class="l">Valor</span><span class="v">'+fmt(c.valor)+'</span></div>'+
      '<div class="row-list"><span class="l">Vistoria</span><span class="v">'+(c.vistoria||'A conferir')+'</span></div>'+
      '<div class="row-list"><span class="l">Status</span><span class="v">'+c.status+'</span></div>'+
    '</div>';
  });

  return html;
}

function telaContratosProprietario(){
  var contratos = SESSAO.contratos;
  var html = '<div class="greeting"><h2>📄 Meus Contratos</h2><p>Detalhes contratuais</p></div>';

  contratos.forEach(function(c){
    html += '<div class="card"><h3>'+c.id+'</h3>'+
      '<div class="row-list"><span class="l">Inquilino</span><span class="v">'+c.inq+'</span></div>'+
      '<div class="row-list"><span class="l">Imóvel</span><span class="v" style="text-align:right;max-width:60%">'+c.end+'</span></div>'+
      '<div class="row-list"><span class="l">Valor</span><span class="v">'+fmt(c.valor)+'</span></div>'+
      '<div class="row-list"><span class="l">Início</span><span class="v">'+formatarData(c.inicio)+'</span></div>'+
      '<div class="row-list"><span class="l">Fim</span><span class="v">'+formatarData(c.fim)+'</span></div>'+
      '<div class="row-list"><span class="l">Corretor</span><span class="v">'+(c.corretor||'-')+'</span></div>'+
    '</div>';
  });

  html += '<div class="card" style="text-align:center;color:var(--muted);font-size:12px">'+
    '📎 Cópia digital do contrato disponível na imobiliária. Em caso de dúvidas, entre em contato pelo WhatsApp.'+
  '</div>';

  return html;
}

// ============================================================
// HELPERS
// ============================================================
function formatarData(d){
  if(!d) return '-';
  var p = d.split('-');
  if(p.length !== 3) return d;
  return p[2]+'/'+p[1]+'/'+p[0];
}

function openModal(html){
  document.getElementById('modal-box').innerHTML = html;
  document.getElementById('modal-bg').style.display = 'flex';
}
function closeModal(){
  document.getElementById('modal-bg').style.display = 'none';
}
document.addEventListener('click', function(e){
  if(e.target.id === 'modal-bg') closeModal();
});
