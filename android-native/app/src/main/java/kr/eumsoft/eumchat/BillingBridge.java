package kr.eumsoft.eumchat;

import android.app.Activity;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClient.BillingResponseCode;
import com.android.billingclient.api.BillingClient.ProductType;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.ConsumeParams;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 웹 화면(window.EumNative.call)과 Google Play 결제를 잇는다.
 * 결과는 window.__eumNative(id, ok, 결과) 로 돌려준다.
 * 실제 포인트 지급·구독 확인은 서버가 Google 에 결제를 다시 확인한 뒤에 한다.
 */
public class BillingBridge implements PurchasesUpdatedListener {
    private final Activity act;
    private final WebView web;
    private final BillingClient client;
    private final Map<String, ProductDetails> details = new HashMap<>();
    private final Map<String, Runnable> waiting = new LinkedHashMap<>();
    private boolean connecting;
    private String buyId;
    private String buySku;

    BillingBridge(Activity act, WebView web) {
        this.act = act;
        this.web = web;
        client = BillingClient.newBuilder(act)
            .setListener(this)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .build();
    }

    void end() { try { client.endConnection(); } catch (Exception ignored) { } }

    @JavascriptInterface
    public void call(String id, String method, String arg) {
        act.runOnUiThread(() -> {
            try {
                JSONObject a = new JSONObject(arg == null || arg.isEmpty() ? "{}" : arg);
                ready(id, () -> run(id, method, a));
            } catch (Exception e) {
                fail(id, "요청을 처리하지 못했습니다.");
            }
        });
    }

    private void ready(String id, Runnable r) {
        if (client.isReady()) { r.run(); return; }
        waiting.put(id, r);
        if (connecting) return;
        connecting = true;
        client.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult res) {
                act.runOnUiThread(() -> {
                    connecting = false;
                    Map<String, Runnable> list = new LinkedHashMap<>(waiting);
                    waiting.clear();
                    boolean ok = res.getResponseCode() == BillingResponseCode.OK;
                    for (Map.Entry<String, Runnable> e : list.entrySet()) {
                        if (ok) e.getValue().run(); else fail(e.getKey(), "Google Play 결제에 연결하지 못했습니다.");
                    }
                });
            }

            @Override
            public void onBillingServiceDisconnected() { act.runOnUiThread(() -> connecting = false); }
        });
    }

    private void run(String id, String m, JSONObject a) {
        try {
            switch (m) {
                case "prices": {
                    List<String> skus = new ArrayList<>();
                    JSONArray arr = a.optJSONArray("skus");
                    if (arr != null) for (int i = 0; i < arr.length(); i++) skus.add(arr.getString(i));
                    load(skus, () -> {
                        JSONObject out = new JSONObject();
                        try {
                            for (String sku : skus) { ProductDetails pd = details.get(sku); if (pd != null) out.put(sku, priceOf(pd)); }
                        } catch (Exception ignored) { }
                        reply(id, true, out.toString());
                    });
                    break;
                }
                case "buy": {
                    String sku = a.optString("sku");
                    load(Collections.singletonList(sku), () -> buy(id, sku));
                    break;
                }
                case "pending": {
                    JSONArray out = new JSONArray();
                    queryOwned(ProductType.INAPP, out, () -> queryOwned(ProductType.SUBS, out, () -> reply(id, true, out.toString())));
                    break;
                }
                case "consume": {
                    String token = a.optString("token");
                    client.consumeAsync(ConsumeParams.newBuilder().setPurchaseToken(token).build(),
                        (r, t) -> act.runOnUiThread(() -> reply(id, true, "true")));
                    break;
                }
                default:
                    fail(id, "알 수 없는 요청입니다.");
            }
        } catch (Exception e) {
            fail(id, "요청을 처리하지 못했습니다.");
        }
    }

    private void buy(String id, String sku) {
        ProductDetails pd = details.get(sku);
        if (pd == null) { fail(id, "Google Play에서 상품을 찾을 수 없습니다."); return; }
        BillingFlowParams.ProductDetailsParams.Builder pb = BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(pd);
        if (ProductType.SUBS.equals(pd.getProductType())) {
            List<ProductDetails.SubscriptionOfferDetails> offers = pd.getSubscriptionOfferDetails();
            if (offers == null || offers.isEmpty()) { fail(id, "구독 요금제를 찾을 수 없습니다."); return; }
            pb.setOfferToken(offers.get(0).getOfferToken());
        }
        if (buyId != null) reply(buyId, true, "null");
        buyId = id;
        buySku = sku;
        BillingResult r = client.launchBillingFlow(act, BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(Collections.singletonList(pb.build())).build());
        if (r.getResponseCode() != BillingResponseCode.OK) {
            buyId = null;
            if (r.getResponseCode() == BillingResponseCode.ITEM_ALREADY_OWNED) fail(id, "이미 구매한 상품입니다. 잠시 후 다시 열어 주세요.");
            else reply(id, true, "null");
        }
    }

    @Override
    public void onPurchasesUpdated(BillingResult r, List<Purchase> purchases) {
        act.runOnUiThread(() -> {
            if (buyId == null) return;
            String id = buyId;
            buyId = null;
            if (r.getResponseCode() == BillingResponseCode.OK && purchases != null) {
                for (Purchase p : purchases) {
                    if (!p.getProducts().contains(buySku)) continue;
                    if (p.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
                        try { reply(id, true, new JSONObject().put("token", p.getPurchaseToken()).toString()); } catch (Exception e) { fail(id, "결제 정보를 읽지 못했습니다."); }
                        return;
                    }
                    if (p.getPurchaseState() == Purchase.PurchaseState.PENDING) { fail(id, "결제가 대기 중입니다. 완료되면 충전 화면을 다시 열어 주세요."); return; }
                }
            }
            reply(id, true, "null"); // 취소 등
        });
    }

    /** 아직 모르는 상품 정보를 Google Play 에서 불러온다(일회성 → 구독 순). */
    private void load(List<String> skus, Runnable then) {
        List<String> need = new ArrayList<>();
        for (String s : skus) if (s != null && !s.isEmpty() && !details.containsKey(s)) need.add(s);
        if (need.isEmpty()) { then.run(); return; }
        query(need, ProductType.INAPP, () -> {
            List<String> rest = new ArrayList<>();
            for (String s : need) if (!details.containsKey(s)) rest.add(s);
            if (rest.isEmpty()) then.run(); else query(rest, ProductType.SUBS, then);
        });
    }

    private void query(List<String> ids, String type, Runnable then) {
        List<QueryProductDetailsParams.Product> list = new ArrayList<>();
        for (String s : ids) list.add(QueryProductDetailsParams.Product.newBuilder().setProductId(s).setProductType(type).build());
        client.queryProductDetailsAsync(QueryProductDetailsParams.newBuilder().setProductList(list).build(), (res, pds) -> act.runOnUiThread(() -> {
            if (pds != null) for (ProductDetails pd : pds) details.put(pd.getProductId(), pd);
            then.run();
        }));
    }

    private void queryOwned(String type, JSONArray out, Runnable then) {
        client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(type).build(), (res, ps) -> act.runOnUiThread(() -> {
            if (ps != null) for (Purchase p : ps) {
                if (p.getPurchaseState() != Purchase.PurchaseState.PURCHASED) continue;
                for (String sku : p.getProducts()) {
                    try { out.put(new JSONObject().put("sku", sku).put("token", p.getPurchaseToken())); } catch (Exception ignored) { }
                }
            }
            then.run();
        }));
    }

    private static String priceOf(ProductDetails pd) {
        if (ProductType.INAPP.equals(pd.getProductType()) && pd.getOneTimePurchaseOfferDetails() != null) {
            return pd.getOneTimePurchaseOfferDetails().getFormattedPrice();
        }
        List<ProductDetails.SubscriptionOfferDetails> offers = pd.getSubscriptionOfferDetails();
        if (offers != null && !offers.isEmpty() && !offers.get(0).getPricingPhases().getPricingPhaseList().isEmpty()) {
            return offers.get(0).getPricingPhases().getPricingPhaseList().get(0).getFormattedPrice();
        }
        return "";
    }

    private void fail(String id, String msg) { reply(id, false, JSONObject.quote(msg)); }

    private void reply(String id, boolean ok, String json) {
        act.runOnUiThread(() -> web.evaluateJavascript(
            "window.__eumNative&&window.__eumNative(" + JSONObject.quote(id) + "," + ok + "," + json + ")", null));
    }
}
