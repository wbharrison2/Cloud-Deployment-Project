function renderCartPage() {
  var cart = getCart();
  var el = document.getElementById('cart-items');
  var checkoutBtn = document.getElementById('checkout-btn');
  if (!el) return;
  if (!cart.length) {
    el.innerHTML = '<div style="text-align:center;padding:40px"><p>Your cart is empty.</p><a href="/shop.html" class="btn btn-primary" style="margin-top:16px">Start Shopping</a></div>';
    if (checkoutBtn) checkoutBtn.style.display = 'none';
    updateTotals(0);
    return;
  }
  var total = 0;
  el.innerHTML = cart.map(function(item) {
    total += item.price * item.quantity;
    return '<div class="cart-item">' +
      (item.image_url
        ? '<img class="cart-item-img" src="' + item.image_url + '" alt="' + item.name + '" onerror="this.style.display=\'none\'">'
        : '<div class="cart-item-img"></div>') +
      '<div class="cart-item-info">' +
      '<div class="cart-item-name">' + item.name + '</div>' +
      '<div class="cart-item-price">' + formatPrice(item.price) + ' each</div>' +
      '<div class="cart-item-controls">' +
      '<button onclick="adjustCartItem(' + item.id + ', -1)">-</button>' +
      '<span>' + item.quantity + '</span>' +
      '<button onclick="adjustCartItem(' + item.id + ', 1)">+</button>' +
      '<button class="cart-item-remove" onclick="removeCartItem(' + item.id + ')">Remove</button>' +
      '</div></div>' +
      '<div style="font-weight:600;color:var(--accent)">' + formatPrice(item.price * item.quantity) + '</div>' +
      '</div>';
  }).join('');
  updateTotals(total);
}

function adjustCartItem(id, delta) {
  var cart = getCart();
  var idx = cart.findIndex(function(i) { return i.id === id; });
  if (idx < 0) return;
  cart[idx].quantity = Math.max(1, Math.min(cart[idx].quantity + delta, cart[idx].stock || 99));
  saveCart(cart);
  renderCartPage();
}

function removeCartItem(id) {
  var cart = getCart().filter(function(i) { return i.id !== id; });
  saveCart(cart);
  renderCartPage();
}

function updateTotals(total) {
  var sub = document.getElementById('cart-subtotal');
  var tot = document.getElementById('cart-total');
  if (sub) sub.textContent = formatPrice(total);
  if (tot) tot.textContent = formatPrice(total);
}
