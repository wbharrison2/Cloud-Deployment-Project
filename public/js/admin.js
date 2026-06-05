var _allStores = [];
var _editingProductId = null;
var _adminTempToken = null;

async function checkAdminAuth() {
  var user = await fetchAPI('/api/auth/me');
  if (!user || !user.user || user.user.role !== 'admin') {
    document.getElementById('admin-login-overlay').style.display = 'flex';
    return;
  }
  document.getElementById('admin-login-overlay').style.display = 'none';
  await loadStores();
  showTab('dashboard');
}

async function handleAdminLogin() {
  var email = document.getElementById('admin-email').value;
  var password = document.getElementById('admin-password').value;
  var errEl = document.getElementById('admin-login-error');
  errEl.textContent = '';
  var result = await fetchAPI('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, password: password }),
  });
  if (result && result.two_factor_required) {
    _adminTempToken = result.temp_token;
    document.getElementById('admin-login-section').style.display = 'none';
    document.getElementById('admin-2fa-section').style.display = 'block';
    return;
  }
  if (result && result.user && result.user.role === 'admin') {
    document.getElementById('admin-login-overlay').style.display = 'none';
    await loadStores();
    showTab('dashboard');
    return;
  }
  errEl.textContent = (result && result.error) || 'Login failed';
}

async function handleAdminTwoFA() {
  var code = document.getElementById('admin-2fa-code').value;
  var errEl = document.getElementById('admin-2fa-error');
  var result = await fetchAPI('/api/auth/2fa/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ temp_token: _adminTempToken, code: code }),
  });
  if (result && result.user && result.user.role === 'admin') {
    document.getElementById('admin-login-overlay').style.display = 'none';
    await loadStores();
    showTab('dashboard');
    return;
  }
  errEl.textContent = (result && result.error) || '2FA failed';
}

async function handleAdminLogout() {
  await fetchAPI('/api/auth/logout', { method: 'POST' });
  window.location.reload();
}

async function loadStores() {
  var data = await fetchAPI('/api/locations');
  _allStores = Array.isArray(data) ? data : [];
}

function showTab(tab) {
  ['dashboard','products','orders','security'].forEach(function(t) {
    var panel = document.getElementById('panel-' + t);
    var link = document.getElementById('tab-' + t);
    if (panel) panel.style.display = t === tab ? 'block' : 'none';
    if (link) link.classList.toggle('active', t === tab);
  });
  if (tab === 'dashboard') loadDashboard();
  if (tab === 'products') loadProducts();
  if (tab === 'orders') loadOrders();
  if (tab === 'security') { loadSecurityStatus(); loadAuditLog(1); }
  return false;
}

async function loadDashboard() {
  var [products, orders, health] = await Promise.allSettled([
    fetchAPI('/api/admin/products'),
    fetchAPI('/api/admin/orders'),
    fetchAPI('/api/health'),
  ]);
  var statsGrid = document.getElementById('stats-grid');
  var prods = (products.status === 'fulfilled' && products.value) ? products.value : [];
  var ords = (orders.status === 'fulfilled' && orders.value) ? orders.value : [];
  var totalRevenue = ords.reduce(function(s, o) { return s + (o.total || 0); }, 0);
  var pdxOrders = ords.filter(function(o) { return o.store_slug === 'pdx'; }).length;
  var seaOrders = ords.filter(function(o) { return o.store_slug === 'sea'; }).length;
  statsGrid.innerHTML = [
    { label: 'Total Products', value: prods.length },
    { label: 'Total Orders', value: ords.length },
    { label: 'Total Revenue', value: '$' + (totalRevenue / 100).toFixed(2) },
    { label: 'PDX Orders', value: pdxOrders },
    { label: 'SEA Orders', value: seaOrders },
  ].map(function(s) {
    return '<div class="stat-card"><div class="stat-label">' + s.label + '</div><div class="stat-value">' + s.value + '</div></div>';
  }).join('');
  var sysInfo = document.getElementById('system-info');
  var h = (health.status === 'fulfilled' && health.value) ? health.value : { status: 'unknown' };
  sysInfo.innerHTML = '<strong>System Health:</strong> ' + h.status + (h.timestamp ? ' &mdash; ' + new Date(h.timestamp).toLocaleString() : '') + '<br><strong>Platform:</strong> Kubernetes on EKS (demo/project-5-franchise-k8s)';
}

async function loadProducts() {
  var loc = (document.getElementById('product-location-filter') || {}).value || 'all';
  var url = '/api/admin/products' + (loc !== 'all' ? '?location=' + loc : '');
  var products = await fetchAPI(url);
  var tbody = document.getElementById('products-tbody');
  if (!tbody) return;
  if (!products || !products.length) { tbody.innerHTML = '<tr><td colspan="6">No products found.</td></tr>'; return; }
  tbody.innerHTML = products.map(function(p) {
    var locLabel = p.store_slug ? (p.store_slug === 'pdx' ? '<span class="store-tag tag-pdx">PDX</span>' : '<span class="store-tag tag-sea">SEA</span>') : '<span class="store-tag tag-shared">Shared</span>';
    return '<tr>' +
      '<td>' + p.name + '</td>' +
      '<td>$' + (p.price / 100).toFixed(2) + '</td>' +
      '<td>' + p.category + '</td>' +
      '<td>' + p.stock + '</td>' +
      '<td>' + locLabel + '</td>' +
      '<td>' +
      '<button class="btn btn-outline" style="font-size:.8rem;padding:4px 10px" onclick="openProductModal(' + p.id + ')">Edit</button> ' +
      '<button class="btn btn-danger" style="font-size:.8rem;padding:4px 10px" onclick="deleteProduct(' + p.id + ')">Delete</button>' +
      '</td></tr>';
  }).join('');
}

function openProductModal(id) {
  _editingProductId = id || null;
  document.getElementById('modal-title').textContent = id ? 'Edit Product' : 'Add Product';
  document.getElementById('product-modal-error').textContent = '';
  if (!id) {
    ['pf-name','pf-slug','pf-desc','pf-price','pf-category','pf-image'].forEach(function(f) {
      document.getElementById(f).value = '';
    });
    document.getElementById('pf-stock').value = '0';
    document.getElementById('pf-featured').checked = false;
    document.getElementById('pf-store').value = '';
  } else {
    fetchAPI('/api/products?admin=true').then(function(data) {
      if (!data) return;
      var allProducts = data.products || data;
      var p = Array.isArray(allProducts) ? allProducts.find(function(x) { return x.id === id; }) : null;
      if (!p) return;
      document.getElementById('pf-name').value = p.name || '';
      document.getElementById('pf-slug').value = p.slug || '';
      document.getElementById('pf-desc').value = p.description || '';
      document.getElementById('pf-price').value = p.price || '';
      document.getElementById('pf-category').value = p.category || '';
      document.getElementById('pf-stock').value = p.stock || 0;
      document.getElementById('pf-image').value = p.image_url || '';
      document.getElementById('pf-featured').checked = !!p.featured;
      var storeSlug = p.store_slug || '';
      document.getElementById('pf-store').value = storeSlug;
    });
  }
  document.getElementById('product-modal').style.display = 'flex';
}

function closeProductModal() {
  document.getElementById('product-modal').style.display = 'none';
  _editingProductId = null;
}

async function saveProduct() {
  var errEl = document.getElementById('product-modal-error');
  var storeSlug = document.getElementById('pf-store').value;
  var store = storeSlug ? _allStores.find(function(s) { return s.slug === storeSlug; }) : null;
  var body = {
    name: document.getElementById('pf-name').value,
    slug: document.getElementById('pf-slug').value,
    description: document.getElementById('pf-desc').value,
    price: parseInt(document.getElementById('pf-price').value),
    category: document.getElementById('pf-category').value,
    stock: parseInt(document.getElementById('pf-stock').value),
    image_url: document.getElementById('pf-image').value,
    featured: document.getElementById('pf-featured').checked,
    store_id: store ? store.id : null,
  };
  var url = _editingProductId ? '/api/admin/products/' + _editingProductId : '/api/admin/products';
  var method = _editingProductId ? 'PUT' : 'POST';
  var result = await fetchAPI(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (result && result.error) { errEl.textContent = result.error; return; }
  closeProductModal();
  loadProducts();
}

async function deleteProduct(id) {
  if (!confirm('Delete this product?')) return;
  await fetchAPI('/api/admin/products/' + id, { method: 'DELETE' });
  loadProducts();
}

async function loadOrders() {
  var loc = (document.getElementById('order-location-filter') || {}).value || 'all';
  var status = (document.getElementById('order-status-filter') || {}).value || '';
  var params = [];
  if (loc !== 'all') params.push('location=' + loc);
  if (status) params.push('status=' + status);
  var url = '/api/admin/orders' + (params.length ? '?' + params.join('&') : '');
  var orders = await fetchAPI(url);
  var tbody = document.getElementById('orders-tbody');
  if (!tbody) return;
  if (!orders || !orders.length) { tbody.innerHTML = '<tr><td colspan="7">No orders found.</td></tr>'; return; }
  tbody.innerHTML = orders.map(function(o) {
    var itemCount = Array.isArray(o.items) ? o.items.filter(Boolean).length : 0;
    var storeBadge = o.store_slug === 'pdx'
      ? '<span class="store-tag tag-pdx">PDX</span>'
      : (o.store_slug === 'sea' ? '<span class="store-tag tag-sea">SEA</span>' : '-');
    var statusOptions = ['pending','processing','shipped','delivered','cancelled'].map(function(s) {
      return '<option value="' + s + '"' + (o.status === s ? ' selected' : '') + '>' + s + '</option>';
    }).join('');
    return '<tr>' +
      '<td>#' + o.id + '</td>' +
      '<td>' + new Date(o.created_at).toLocaleDateString() + '</td>' +
      '<td>' + storeBadge + '</td>' +
      '<td>' + (o.customer_email || '') + '</td>' +
      '<td>' + itemCount + '</td>' +
      '<td>$' + ((o.total || 0) / 100).toFixed(2) + '</td>' +
      '<td><select onchange="updateOrderStatus(' + o.id + ', this.value)">' + statusOptions + '</select></td>' +
      '</tr>';
  }).join('');
}

async function updateOrderStatus(id, status) {
  await fetchAPI('/api/admin/orders/' + id + '/status', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: status }),
  });
}

async function loadSecurityStatus() {
  var user = await fetchAPI('/api/auth/me');
  if (!user || !user.user) return;
  var enabled = user.user.totp_enabled;
  var badge = document.getElementById('twofa-badge');
  if (badge) badge.innerHTML = enabled ? '<span class="twofa-enabled-badge">✓ Active</span>' : '<span style="color:var(--muted)">Not enabled</span>';
  var setupArea = document.getElementById('twofa-setup-area');
  var disableArea = document.getElementById('twofa-disable-area');
  if (setupArea) setupArea.style.display = enabled ? 'none' : 'block';
  if (disableArea) disableArea.style.display = enabled ? 'block' : 'none';
}

async function initTwoFASetup() {
  var result = await fetchAPI('/api/auth/2fa/setup', { method: 'POST' });
  if (!result || !result.qr_code) return;
  document.getElementById('twofa-qr-img').src = result.qr_code;
  document.getElementById('btn-setup-2fa').style.display = 'none';
  document.getElementById('twofa-qr-section').style.display = 'block';
}

async function enableTwoFA() {
  var code = document.getElementById('twofa-confirm-code').value;
  var result = await fetchAPI('/api/auth/2fa/enable', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code }),
  });
  if (result && result.backup_codes) {
    document.getElementById('twofa-qr-section').style.display = 'none';
    document.getElementById('backup-codes-list').innerHTML = result.backup_codes.map(function(c) {
      return '<div class="backup-code">' + c + '</div>';
    }).join('');
    document.getElementById('twofa-backup-codes').style.display = 'block';
    loadSecurityStatus();
  }
}

async function disableTwoFA() {
  var code = document.getElementById('twofa-disable-code').value;
  var result = await fetchAPI('/api/auth/2fa/disable', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code }),
  });
  if (result && result.message) loadSecurityStatus();
}

async function loadAuditLog(page) {
  var data = await fetchAPI('/api/admin/audit-log?page=' + page + '&limit=20');
  var tbody = document.getElementById('audit-tbody');
  if (!tbody || !data) return;
  tbody.innerHTML = (data.logs || []).map(function(log) {
    var actionClass = 'audit-action';
    var a = log.action || '';
    if (a.includes('LOGIN')) actionClass += ' audit-login';
    else if (a.includes('LOGOUT')) actionClass += ' audit-logout';
    else if (a.includes('PRODUCT')) actionClass += ' audit-product';
    else if (a.includes('ORDER')) actionClass += ' audit-order';
    else if (a.includes('2FA')) actionClass += ' audit-2fa';
    else if (a.includes('CACHE')) actionClass += ' audit-cache';
    return '<tr>' +
      '<td>' + new Date(log.created_at).toLocaleString() + '</td>' +
      '<td>' + (log.user_email || '-') + '</td>' +
      '<td><span class="' + actionClass + '">' + a + '</span></td>' +
      '<td>' + (log.resource_type ? log.resource_type + (log.resource_id ? ' #' + log.resource_id : '') : '-') + '</td>' +
      '<td>' + (log.ip_address || '-') + '</td>' +
      '</tr>';
  }).join('');
  var pag = document.getElementById('audit-pagination');
  if (!pag) return;
  var totalPages = Math.ceil((data.total || 0) / (data.limit || 20));
  var html = '';
  for (var i = 1; i <= totalPages; i++) {
    html += '<button onclick="loadAuditLog(' + i + ')">' + i + '</button>';
  }
  pag.innerHTML = html;
}

async function clearCache() {
  var fb = document.getElementById('cache-feedback');
  if (fb) { fb.textContent = 'Clearing cache…'; fb.className = 'feedback'; }
  var result = await fetchAPI('/api/admin/cache/clear', { method: 'POST' });
  if (fb) {
    fb.textContent = (result && result.message) ? result.message : (result && result.error) || 'Done';
    fb.className = (result && result.error) ? 'feedback error' : 'feedback success';
  }
}
