package kr.eumsoft.familyalbum

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BillingLogicTest {
    private val offers = listOf(
        BillingLogic.Offer("monthly", null, "t-monthly"),
        BillingLogic.Offer("monthly", "free-trial-7d", "t-monthly-trial"),
        BillingLogic.Offer("yearly", null, "t-yearly"),
    )

    @Test fun picksTrialOfferWhenEligible() {
        assertEquals("t-monthly-trial", BillingLogic.pickOffer(offers, "monthly")?.token)
    }

    @Test fun fallsBackToBasePlan() {
        assertEquals("t-yearly", BillingLogic.pickOffer(offers, "yearly")?.token)
    }

    @Test fun unknownBasePlanReturnsNull() {
        assertNull(BillingLogic.pickOffer(offers, "weekly"))
    }

    @Test fun changeNeedsOldToken() {
        assertTrue(BillingLogic.isChange("old-token"))
        assertFalse(BillingLogic.isChange(null))
        assertFalse(BillingLogic.isChange(" "))
    }

    @Test fun accountIdValidation() {
        assertTrue(BillingLogic.isValidAccountId("cmwqbv9vu0000l94jdi4aypaf"))
        assertFalse(BillingLogic.isValidAccountId(""))
        assertFalse(BillingLogic.isValidAccountId("a".repeat(65)))
        assertFalse(BillingLogic.isValidAccountId("family id with spaces"))
    }

    @Test fun completedTokensAreDistinctAndPurchasedOnly() {
        val list = listOf("a" to 1, "b" to 2, "a" to 1, "c" to 1)
        assertEquals(listOf("a", "c"), BillingLogic.completedTokens(list))
    }
}
