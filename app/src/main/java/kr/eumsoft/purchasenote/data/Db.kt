package kr.eumsoft.purchasenote.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

class Converters {
    @TypeConverter fun s(v: Status): String = v.name
    @TypeConverter fun st(v: String): Status = runCatching { Status.valueOf(v) }.getOrDefault(Status.KEEPING)
}

@Dao
interface PurchaseDao {
    @Query("SELECT * FROM purchase ORDER BY createdAt DESC") fun all(): Flow<List<Purchase>>
    @Query("SELECT * FROM purchase") suspend fun allOnce(): List<Purchase>
    @Query("SELECT * FROM purchase WHERE id = :id") suspend fun get(id: Long): Purchase?
    @Query("SELECT * FROM purchase WHERE id = :id") fun observe(id: Long): Flow<Purchase?>
    @Query("SELECT * FROM purchase WHERE orderKey = :key AND id != :exceptId ORDER BY id") fun sameOrder(key: String, exceptId: Long): Flow<List<Purchase>>
    @Query("SELECT COUNT(*) FROM purchase") suspend fun count(): Int
    @Insert suspend fun insert(p: Purchase): Long
    @Insert suspend fun insertAll(p: List<Purchase>)
    @Update suspend fun update(p: Purchase)
    @Query("DELETE FROM purchase WHERE id = :id") suspend fun delete(id: Long)
    @Query("DELETE FROM purchase") suspend fun deleteAll()

    @Query("SELECT * FROM image") suspend fun images(): List<StoredImage>
    @Query("SELECT * FROM image WHERE sha256 = :sha") suspend fun imageBySha(sha: String): StoredImage?
    @Query("SELECT * FROM image WHERE id = :id") suspend fun image(id: Long): StoredImage?
    @Insert(onConflict = OnConflictStrategy.ABORT) suspend fun insertImage(i: StoredImage): Long
    @Insert suspend fun insertImages(i: List<StoredImage>)
    @Query("UPDATE image SET ocrText = :text WHERE id = :id") suspend fun setOcr(id: Long, text: String)
    @Query("DELETE FROM image WHERE id = :id") suspend fun deleteImage(id: Long)
    @Query("DELETE FROM image") suspend fun deleteAllImages()
    @Query("SELECT image.* FROM image WHERE id NOT IN (SELECT imageId FROM purchase_image)") suspend fun orphanImages(): List<StoredImage>

    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun link(l: PurchaseImage)
    @Insert suspend fun linkAll(l: List<PurchaseImage>)
    @Query("SELECT * FROM purchase_image") suspend fun links(): List<PurchaseImage>
    @Query("DELETE FROM purchase_image WHERE purchaseId = :pid AND imageId = :iid") suspend fun unlink(pid: Long, iid: Long)
    @Query("DELETE FROM purchase_image WHERE purchaseId = :pid") suspend fun unlinkAll(pid: Long)
    @Query("DELETE FROM purchase_image") suspend fun deleteAllLinks()
    @Query("SELECT image.* FROM image JOIN purchase_image ON image.id = purchase_image.imageId WHERE purchase_image.purchaseId = :pid ORDER BY image.id")
    fun imagesOf(pid: Long): Flow<List<StoredImage>>
    @Query("SELECT image.* FROM image JOIN purchase_image ON image.id = purchase_image.imageId WHERE purchase_image.purchaseId = :pid ORDER BY image.id")
    suspend fun imagesOfOnce(pid: Long): List<StoredImage>
    @Query("SELECT purchase.* FROM purchase JOIN purchase_image ON purchase.id = purchase_image.purchaseId WHERE purchase_image.imageId = :iid")
    suspend fun purchasesWithImage(iid: Long): List<Purchase>
}

@Database(entities = [Purchase::class, StoredImage::class, PurchaseImage::class], version = 1, exportSchema = true)
@TypeConverters(Converters::class)
abstract class AppDb : RoomDatabase() {
    abstract fun dao(): PurchaseDao

    companion object {
        @Volatile private var inst: AppDb? = null
        fun get(c: Context): AppDb = inst ?: synchronized(this) {
            inst ?: Room.databaseBuilder(c.applicationContext, AppDb::class.java, "purchase-note.db").build().also { inst = it }
        }
    }
}
