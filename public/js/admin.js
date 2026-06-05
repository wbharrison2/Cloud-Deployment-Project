// Admin panel P4 — location filters, 2FA, audit log
var adminTempToken = null;
var auditCurrentPage = 1;
var allStores = [];

document.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    if (!document.getElementById('admin-login').classList.contains('hidden')) handleAdminLogin();
    if (!document.getElementById('admin-twofa').classList.contains('hidden')) handleAdminTwoFA();
  }
});

async function checkAdminAuth() {
  try {
    var user = await fetchAPI('/api/auth/me');
    if (user.role !== 'admin') throw new Error('Forbidden');
    hideLoginOverlay();
    await loadStores();
    loadDashboard();
  } catch(e) { showLoginOverlay(); }
}

function showLoginOverlay() { document.getElementById('admin-login').classList.remove('hidden'); document.getElementById('admin-twofa').classList.add('hidden'); }
function hideLoginOverlay() { document.getElementById('admin-login').classList.add('hidden'); document.getElementById('admin-twofa').classList.add('hidden'); }

async function handleAdminLogin() {
  var email = document.getElementById('admin-email').value.trim();
  var password = document.getElementById('admin-password').value;
  var err = document.getElementById('admin-login-error'); err.classList.add('hidden');
  try {
    var res = await fetchAPI('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email,password}) });
    if (res.two_factor_required) { adminTempToken = res.temp_token; document.getElementById('admin-login').classList.add('hidden'); document.getElementById('admin-twofa').classList.remove('hidden'); return; }
    hideLoginOverlay(); await loadStores(); loadDashboard();
  } catch(e) { err.textContent = e.message||'Login failed.'; err.classList.remove('hidden'); }
}

async function handleAdminTwoFA() {
  var code = document.getElementById('admin-totp').value.trim();
  var err = document.getElementById('admin-twofa-error'); err.classList.add('hidden');
  try {
    await fetchAPI('/api/auth/2fa/verify', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({temp_token:adminTempToken,token:code}) });
    adminTempToken = null; hideLoginOverlay(); await loadStores(); loadDashboard();
  } catch(e) { err.textContent = e.message||'Invalid code.'; err.classList.remove('hidden'); }
}

function cancelAdminTwoFA() {
  adminTempToken = null;
  document.getElementById('admin-twofa').classList.add('hidden');
  document.getElementById('admin-login').classList.remove('hidden');
  document.getElementById('admin-totp').value = '';
}

async function handleAdminLogout() {
  try { await fetchAPI('/api/auth/logout', { method:'POST' }); } catch(e) {}
  showLoginOverlay();
}

function showTab(name) {
  ['dashboard','products','orders','security'].forEach(function(t) {
    document.getElementById('tab-'+t).classList.toggle('hidden', t!==name);
    document.getElementById('nav-'+t).classList.toggle('active', t===name);
  });
  if (name==='products') loadProducts();
  if (name==='orders')   loadOrders();
  if (name==='security') loadSecurityStatus();
}

async function loadStores() {
  try { var res = await fetchAPI('/api/locations'); allStores = res.locations || []; } catch(e) {}
}

async function loadDashboard() {
  try {
    var results = await Promise.allSettled([
      fetchAPI('/api/admin/products'),
      fetchAPI('/api/admin/orders'),
      fetchAPI('/api/admin/orders?location=pdx'),
      fetchAPI('/api/admin/orders?location=sea'),
      fetchAPI('/health')
    ]);
    var products = results[0].status==='fulfilled' ? (results[0].value.products||[]) : [];
    var orders   = results[1].status==='fulfilled' ? (results[1].value.orders||[]) : [];
    var pdxOrds  = results[2].status==='fulfilled' ? (results[2].value.orders||[]) : [];
    var seaOrds  = results[3].status==='fulfilled' ? (results[3].value.orders||[]) : [];
    var health   = results[4].status==='fulfilled' ? results[4].value : null;
    document.getElementById('stat-products').textContent  = products.length;
    document.getElementById('stat-orders').textContent    = orders.length;
    document.getElementById('stat-pdx-orders').textContent = pdxOrds.length;
    document.getElementById('stat-sea-orders').textContent = seaOrds.length;
    document.getElementById('stat-cache').textContent     = health&&health.redis==='ok' ? 'Online' : 'Offline';
  } catch(e) {}
}

async function clearCache() {
  var fb = document.getElementById('dashboard-feedback');
  try {
    var res = await fetchAPI('/api/admin/cache/clear', { method:'POST' });
    fb.textContent = res.message||'Cache cleared.'; fb.className = 'feedback success';
  } catch(e) { fb.textContent = e.message||'Failed.'; fb.className = 'feedback error'; }
  setTimeout(function(){fb.className='feedback hidden';}, 4000);
}

async function loadProducts() {
  var wrapper = document.getElementById('products-table-wrapper');
  var filter  = document.getElementById('product-location-filter').value;
  try {
    var res = await fetchAPI('/api/admin/products');
    var products = res.products || res;
    if (filter === 'shared') products = products.filter(function(p) { return !p.store_slug; });
    else if (filter) products = products.filter(function(p) { return p.store_slug === filter; });
    wrapper.innerHTML = renderProductsTable(products);
  } catch(e) { wrapper.innerHTML = '<p class="text-muted">Failed to load products.</p>'; }
}

function renderProductsTable(products) {
  if (!products.length) return '<p class="text-muted">No products found.</p>';
  return '<table class="data-table"><thead><tr><th>Name</th><th>Location</th><th>Category</th><th>Price</th><th>Stock</th><th>Actions</th></tr></thead><tbody>' +
    products.map(function(p) {
      var tag = p.store_slug ? '<span class="store-tag tag-'+p.store_slug+'">'+p.store_slug.toUpperCase()+'</span>' : '<span class="store-tag tag-shared">Shared</span>';
      var safeP = JSON.stringify(p).replace(/"/g,'&quot;');
      return '<tr><td>'+p.name+'</td><td>'+tag+'</td><td>'+(p.category||'—')+'</td><td>'+formatPrice(p.price)+'</td><td>'+p.stock+'</td><td>'+
        '<button class="btn btn-outline btn-sm" onclick="openProductModal('+safeP+')">Edit</button> '+
        '<button class="btn btn-danger btn-sm" onclick="deleteProduct('+p.id+')">Delete</button></td></tr>';
    }).join('') + '</tbody></table>';
}

function openProductModal(product) {
  var isEdit = !!product;
  document.getElementById('modal-title').textContent = isEdit ? 'Edit Product' : 'Add Product';
  document.getElementById('modal-product-id').value  = isEdit ? product.id : '';
  document.getElementById('modal-name').value        = isEdit ? product.name : '';
  document.getElementById('modal-slug').value        = isEdit ? product.slug : '';
  document.getElementById('modal-description').value = isEdit ? (product.description||'') : '';
  document.getElementById('modal-price').value       = isEdit ? (product.price/100).toFixed(2) : '';
  document.getElementById('modal-stock').value       = isEdit ? product.stock : '';
  document.getElementById('modal-category').value    = isEdit ? (product.category||'') : '';
  document.getElementById('modal-material').value    = isEdit ? (product.material||'') : '';
  document.getElementById('modal-featured').checked  = isEdit ? !!product.featured : false;
  var storeSelect = document.getElementById('modal-store-id');
  storeSelect.value = isEdit ? (product.store_slug||'') : '';
  document.getElementById('modal-error').classList.add('hidden');
  document.getElementById('product-modal').classList.remove('hidden');
}

function closeProductModal() { document.getElementById('product-modal').classList.add('hidden'); }
function closeModalOnBackdrop(e) { if (e.target.id==='product-modal') closeProductModal(); }

async function saveProduct() {
  var id   = document.getElementById('modal-product-id').value;
  var err  = document.getElementById('modal-error'); err.classList.add('hidden');
  var storeSlug = document.getElementById('modal-store-id').value;
  var storeId = null;
  if (storeSlug) {
    var store = allStores.find(function(s){return s.slug===storeSlug;});
    storeId = store ? store.id : null;
  }
  var data = {
    name: document.getElementById('modal-name').value.trim(),
    slug: document.getElementById('modal-slug').value.trim(),
    description: document.getElementById('modal-description').value.trim(),
    price: Math.round(parseFloat(document.getElementById('modal-price').value)*100),
    stock: parseInt(document.getElementById('modal-stock').value),
    category: document.getElementById('modal-category').value.trim(),
    material: document.getElementById('modal-material').value.trim(),
    featured: document.getElementById('modal-featured').checked,
    store_id: storeId
  };
  try {
    var url = id ? '/api/admin/products/'+id : '/api/admin/products';
    await fetchAPI(url, { method: id?'PUT':'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
    closeProductModal(); loadProducts();
  } catch(e) { err.textContent = e.message||'Save failed.'; err.classList.remove('hidden'); }
}

async function deleteProduct(id) {
  if (!confirm('Delete this product?')) return;
  try { await fetchAPI('/api/admin/products/'+id, {method:'DELETE'}); loadProducts(); }
  catch(e) { alert(e.message||'Delete failed.'); }
}

async function loadOrders() {
  var wrapper = document.getElementById('orders-table-wrapper');
  var loc = document.getElementById('order-location-filter').value;
  var url = '/api/admin/orders' + (loc ? '?location='+loc : '');
  try {
    var res = await fetchAPI(url);
    var orders = res.orders || res;
    if (!orders.length) { wrapper.innerHTML = '<p class="text-muted">No orders found.</p>'; return; }
    wrapper.innerHTML = '<table class="data-table"><thead><tr><th>#</th><th>Location</th><th>Customer</th><th>Total</th><th>Status</th><th>Date</th><th>Update</th></tr></thead><tbody>' +
      orders.map(function(o) {
        var opts = ['pending','processing','shipped','delivered','cancelled'].map(function(s){
          return '<option'+(s===o.status?' selected':'')+'>'+ s+'</option>';
        }).join('');
        var locTag = o.store_slug ? '<span class="store-tag tag-'+o.store_slug+'">'+o.store_slug.toUpperCase()+'</span>' : '—';
        return '<tr><td>#'+o.id+'</td><td>'+locTag+'</td><td>'+(o.customer_email||'—')+'</td><td>'+formatPrice(o.total)+'</td>' +
          '<td><span class="status-badge status-'+o.status+'">'+o.status+'</span></td>' +
          '<td>'+new Date(o.created_at).toLocaleDateString()+'</td>' +
          '<td><select class="status-select" onchange="updateOrderStatus('+o.id+',this.value)">'+opts+'</select></td></tr>';
      }).join('') + '</tbody></table>';
  } catch(e) { wrapper.innerHTML = '<p class="text-muted">Failed to load orders.</p>'; }
}

async function updateOrderStatus(id, status) {
  try { await fetchAPI('/api/admin/orders/'+id, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status}) }); }
  catch(e) { alert(e.message||'Update failed.'); }
}

async function loadSecurityStatus() {
  try {
    var user = await fetchAPI('/api/auth/me');
    var msg  = document.getElementById('twofa-status-msg');
    if (user.totp_enabled) {
      msg.textContent = '2FA is currently enabled on your account.';
      document.getElementById('twofa-setup-init').classList.add('hidden');
      document.getElementById('twofa-setup-qr').classList.add('hidden');
      document.getElementById('twofa-setup-done').classList.remove('hidden');
      document.getElementById('backup-codes-section').classList.add('hidden');
    } else {
      msg.textContent = 'Two-factor authentication is not enabled. We strongly recommend enabling it.';
      document.getElementById('twofa-setup-init').classList.remove('hidden');
      document.getElementById('twofa-setup-qr').classList.add('hidden');
      document.getElementById('twofa-setup-done').classList.add('hidden');
    }
  } catch(e) {}
  loadAuditLog(1);
}

async function initTwoFASetup() {
  try {
    var res = await fetchAPI('/api/auth/2fa/setup');
    document.getElementById('twofa-qr-container').innerHTML = '<img src="'+res.qr_code+'" alt="2FA QR" style="max-width:200px">';
    document.getElementById('twofa-secret-text').textContent = res.secret;
    document.getElementById('twofa-setup-init').classList.add('hidden');
    document.getElementById('twofa-setup-qr').classList.remove('hidden');
  } catch(e) { alert(e.message||'Failed.'); }
}

function cancelTwoFASetup() {
  document.getElementById('twofa-setup-qr').classList.add('hidden');
  document.getElementById('twofa-setup-init').classList.remove('hidden');
}

async function enableTwoFA() {
  var code = document.getElementById('twofa-confirm-code').value.trim();
  var err  = document.getElementById('twofa-setup-error'); err.classList.add('hidden');
  try {
    var res = await fetchAPI('/api/auth/2fa/enable', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({token:code}) });
    document.getElementById('twofa-setup-qr').classList.add('hidden');
    document.getElementById('twofa-setup-done').classList.remove('hidden');
    document.getElementById('twofa-status-msg').textContent = '2FA is now active.';
    if (res.backup_codes && res.backup_codes.length) {
      document.getElementById('backup-codes-grid').innerHTML = res.backup_codes.map(function(c){return '<code class="backup-code">'+c+'</code>';}).join('');
      document.getElementById('backup-codes-section').classList.remove('hidden');
    }
  } catch(e) { err.textContent = e.message||'Invalid code.'; err.classList.remove('hidden'); }
}

async function disableTwoFA() {
  var code = document.getElementById('twofa-disable-code').value.trim();
  var err  = document.getElementById('twofa-disable-error'); err.classList.add('hidden');
  if (!confirm('Disable 2FA? This reduces security.')) return;
  try {
    await fetchAPI('/api/auth/2fa/disable', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({token:code}) });
    loadSecurityStatus();
  } catch(e) { err.textContent = e.message||'Invalid code.'; err.classList.remove('hidden'); }
}

async function loadAuditLog(page) {
  page = page || 1; auditCurrentPage = page;
  var wrapper = document.getElementById('audit-log-wrapper');
  var pager   = document.getElementById('audit-pagination');
  try {
    var res = await fetchAPI('/api/admin/audit-log?page='+page+'&limit=20');
    var logs = res.logs || res; var totalPages = res.total_pages || 1;
    if (!logs.length) { wrapper.innerHTML = '<p class="text-muted">No audit events.</p>'; pager.innerHTML=''; return; }
    wrapper.innerHTML = '<div class="table-scroll"><table class="data-table"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>IP</th><th>Details</th></tr></thead><tbody>' +
      logs.map(function(l) {
        var prefix = (l.action||'').toLowerCase().split('_')[0];
        return '<tr><td>'+new Date(l.created_at).toLocaleString()+'</td><td>'+(l.user_email||'—')+'</td>' +
          '<td><span class="audit-action audit-'+prefix+'">'+l.action+'</span></td>' +
          '<td>'+(l.ip_address||'—')+'</td>' +
          '<td style="font-size:.8rem;color:var(--text-muted)">'+(l.details?JSON.stringify(l.details).substring(0,60):'—')+'</td></tr>';
      }).join('') + '</tbody></table></div>';
    var ph = '';
    if (page>1)           ph += '<button class="btn btn-outline btn-sm" onclick="loadAuditLog('+(page-1)+')">Previous</button> ';
    ph += '<span class="page-info">Page '+page+' of '+totalPages+'</span>';
    if (page<totalPages)  ph += ' <button class="btn btn-outline btn-sm" onclick="loadAuditLog('+(page+1)+')">Next</button>';
    pager.innerHTML = ph;
  } catch(e) { wrapper.innerHTML = '<p class="text-muted">Failed to load audit log.</p>'; }
}
