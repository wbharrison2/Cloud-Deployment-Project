// Cart page
function renderCartPage() {
  var cart = getCart();
  var ic = document.getElementById('cart-items');
  var ed = document.getElementById('cart-empty');
  var sd = document.getElementById('cart-summary');
  if (!cart.length) { if (ed) ed.classList.remove('hidden'); if (sd) sd.classList.add('hidden'); return; }
  if (ed) ed.classList.add('hidden'); if (sd) sd.classList.remove('hidden');
  ic.innerHTML = cart.map(function(item) {
    return '<div class="cart-item">' +
      '<div class="cart-item-image"><div class="img-placeholder">Jewelry</div></div>' +
      '<div class="cart-item-details"><h3><a href="/product.html?slug=' + item.slug + '">' + item.name + '</a></h3>' +
      '<p class="cart-item-price">' + formatPrice(item.price) + '</p></div>' +
      '<div class="cart-item-controls">' +
        '<button class="qty-btn" onclick="adjustCartItem(' + item.id + ',-1)">−</button>' +
        '<span class="cart-item-qty">' + item.quantity + '</span>' +
        '<button class="qty-btn" onclick="adjustCartItem(' + item.id + ',1)">+</button>' +
      '</div>' +
      '<div class="cart-item-total">' + formatPrice(item.price * item.quantity) + '</div>' +
      '<button class="cart-item-remove" onclick="removeCartItem(' + item.id + ')">&times;</button>' +
    '</div>';
  }).join('');
  var total = cart.reduce(function(s,i) { return s + i.price * i.quantity; }, 0);
  var sub = document.getElementById('cart-subtotal'); if (sub) sub.textContent = formatPrice(total);
  var tot = document.getElementById('cart-total');    if (tot) tot.textContent = formatPrice(total);
  updateCartCount();
}
function adjustCartItem(id, d) {
  var cart = getCart(); var item = cart.find(function(i){return i.id===id;});
  if (!item) return; item.quantity = Math.max(1, Math.min(10, item.quantity+d));
  saveCart(cart); renderCartPage();
}
function removeCartItem(id) { saveCart(getCart().filter(function(i){return i.id!==id;})); renderCartPage(); }
