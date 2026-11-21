package kr.eumsoft.familyalbum

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import org.json.JSONArray
import org.json.JSONObject

/**
 * 웹앱 ↔ Google Play 결제 연결. 웹에서 window.FamilyAlbumBilling.* 를 부르고,
 * 결과는 window.__faBilling(event, json) 으로 돌려준다.
 * 결제 확정(승인·권한 부여)은 반드시 서버(/api/billing/play/verify)가 Google 에 확인한 뒤 한다.
 */
class BillingBridge(private val activity: Activity, private val webView: WebView) : PurchasesUpdatedListener {

    private val client: BillingClient = BillingClient.newBuilder(activity)
        .setListener(this)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .build()

    private val details = mutableMapOf<String, ProductDetails>()

    private fun connected(block: () -> Unit) {
        if (client.isReady) {
            block()
            return
        }
        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode == BillingClient.BillingResponseCode.OK) block()
                else emit("error", JSONObject().put("code", result.responseCode).put("message", result.debugMessage))
            }

            override fun onBillingServiceDisconnected() {}
        })
    }

    private fun emit(event: String, data: Any) {
        val json = JSONObject.quote(data.toString())
        activity.runOnUiThread {
            webView.evaluateJavascript("window.__faBilling && window.__faBilling(${JSONObject.quote(event)}, JSON.parse($json));", null)
        }
    }

    @JavascriptInterface
    fun isAvailable(): Boolean = true

    /** productIds: 쉼표로 구분한 구독 상품 ID */
    @JavascriptInterface
    fun queryProducts(productIds: String) {
        activity.runOnUiThread {
            connected {
                val products = productIds.split(",").map { it.trim() }.filter { it.isNotEmpty() }.map {
                    QueryProductDetailsParams.Product.newBuilder().setProductId(it).setProductType(BillingClient.ProductType.SUBS).build()
                }
                val params = QueryProductDetailsParams.newBuilder().setProductList(products).build()
                client.queryProductDetailsAsync(params) { result, queryResult ->
                    if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                        emit("error", JSONObject().put("code", result.responseCode).put("message", result.debugMessage))
                        return@queryProductDetailsAsync
                    }
                    val out = JSONArray()
                    for (pd in queryResult.productDetailsList) {
                        details[pd.productId] = pd
                        for (offer in pd.subscriptionOfferDetails.orEmpty()) {
                            val phases = offer.pricingPhases.pricingPhaseList
                            val last = phases.lastOrNull() ?: continue
                            out.put(
                                JSONObject()
                                    .put("productId", pd.productId)
                                    .put("basePlanId", offer.basePlanId)
                                    .put("offerId", offer.offerId ?: JSONObject.NULL)
                                    .put("price", last.formattedPrice)
                                    .put("priceMicros", last.priceAmountMicros)
                                    .put("period", last.billingPeriod)
                                    .put("trial", phases.any { it.priceAmountMicros == 0L }),
                            )
                        }
                    }
                    emit("products", out)
                }
            }
        }
    }

    /**
     * 구매 시작. accountId = 가족 ID, profileId = 사용자 ID (서버가 결제를 가족에 연결할 때 확인한다).
     * oldPurchaseToken 을 주면 기존 구독에서 바꾸는(업·다운그레이드) 결제로 연다.
     */
    @JavascriptInterface
    fun purchase(productId: String, basePlanId: String, accountId: String, profileId: String, oldPurchaseToken: String?) {
        activity.runOnUiThread {
            connected {
                val pd = details[productId]
                if (pd == null) {
                    emit("error", JSONObject().put("code", -1).put("message", "상품 정보를 먼저 불러와 주세요."))
                    return@connected
                }
                val offers = pd.subscriptionOfferDetails.orEmpty().filter { it.basePlanId == basePlanId }
                // 무료 체험 등 혜택이 있으면 그 혜택을, 없으면 기본 요금제를 쓴다 (자격이 없으면 Play 가 목록에서 뺀다)
                val offer = offers.firstOrNull { it.offerId != null } ?: offers.firstOrNull()
                if (offer == null) {
                    emit("error", JSONObject().put("code", -1).put("message", "요금제를 찾을 수 없습니다."))
                    return@connected
                }
                val productParams = BillingFlowParams.ProductDetailsParams.newBuilder()
                    .setProductDetails(pd)
                    .setOfferToken(offer.offerToken)
                    .build()
                val builder = BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(listOf(productParams))
                    .setObfuscatedAccountId(accountId)
                    .setObfuscatedProfileId(profileId)
                if (!oldPurchaseToken.isNullOrBlank()) {
                    builder.setSubscriptionUpdateParams(
                        BillingFlowParams.SubscriptionUpdateParams.newBuilder()
                            .setOldPurchaseToken(oldPurchaseToken)
                            .setSubscriptionReplacementMode(BillingFlowParams.SubscriptionUpdateParams.ReplacementMode.WITH_TIME_PRORATION)
                            .build(),
                    )
                }
                val result = client.launchBillingFlow(activity, builder.build())
                if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                    emit("error", JSONObject().put("code", result.responseCode).put("message", result.debugMessage))
                }
            }
        }
    }

    /** 이 기기 Google 계정의 구독을 다시 읽어 서버에 확인시킨다 (구매 복원) */
    @JavascriptInterface
    fun restore() {
        activity.runOnUiThread {
            connected {
                client.queryPurchasesAsync(
                    QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build(),
                ) { result, purchases ->
                    if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                        emit("error", JSONObject().put("code", result.responseCode).put("message", result.debugMessage))
                        return@queryPurchasesAsync
                    }
                    emit("purchases", purchasesJson(purchases))
                }
            }
        }
    }

    /** Play 정기 결제 관리 화면 (해지·결제수단 변경) */
    @JavascriptInterface
    fun manage(productId: String?) {
        val url = if (productId.isNullOrBlank()) {
            "https://play.google.com/store/account/subscriptions"
        } else {
            "https://play.google.com/store/account/subscriptions?sku=${Uri.encode(productId)}&package=${activity.packageName}"
        }
        activity.runOnUiThread {
            try {
                activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            } catch (e: Exception) {
                Log.w(TAG, "manage subscriptions", e)
            }
        }
    }

    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> emit("purchases", purchasesJson(purchases.orEmpty()))
            BillingClient.BillingResponseCode.USER_CANCELED -> emit("canceled", JSONObject())
            else -> emit("error", JSONObject().put("code", result.responseCode).put("message", result.debugMessage))
        }
    }

    private fun purchasesJson(purchases: List<Purchase>): JSONArray {
        val out = JSONArray()
        for (p in purchases) {
            out.put(
                JSONObject()
                    .put("purchaseToken", p.purchaseToken)
                    .put("products", JSONArray(p.products))
                    .put("state", p.purchaseState)
                    .put("acknowledged", p.isAcknowledged),
            )
        }
        return out
    }

    /** 서버가 승인을 실패했을 때를 대비한 기기 쪽 승인 (서버 확인 후 웹이 부른다) */
    @JavascriptInterface
    fun acknowledge(purchaseToken: String) {
        activity.runOnUiThread {
            connected {
                client.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(purchaseToken).build()) { }
            }
        }
    }

    fun destroy() {
        if (client.isReady) client.endConnection()
    }

    companion object {
        private const val TAG = "FamilyAlbumBilling"
    }
}
