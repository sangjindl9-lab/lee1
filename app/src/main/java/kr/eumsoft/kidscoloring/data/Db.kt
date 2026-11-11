package kr.eumsoft.kidscoloring.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "artwork")
data class ArtworkEntity(
    @PrimaryKey val artworkId: String,
    val categoryId: String,
    val title: String,
    val assetPath: String,
    val maskPath: String,
    val difficulty: Int,
)

@Entity(tableName = "coloring_project")
data class ProjectEntity(
    @PrimaryKey(autoGenerate = true) val projectId: Long = 0,
    val artworkId: String,
    val createdAt: Long,
    val updatedAt: Long,
    val thumbnailPath: String,
    val projectFilePath: String,
    val completed: Boolean,
    val name: String,
)

@Dao
interface ArtworkDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(items: List<ArtworkEntity>)

    @Query("SELECT COUNT(*) FROM artwork")
    suspend fun count(): Int
}

@Dao
interface ProjectDao {
    @Query("SELECT * FROM coloring_project ORDER BY updatedAt DESC")
    fun observeAll(): Flow<List<ProjectEntity>>

    @Query("SELECT * FROM coloring_project WHERE projectId = :id")
    suspend fun get(id: Long): ProjectEntity?

    @Query("SELECT * FROM coloring_project WHERE artworkId = :artworkId AND completed = 0 ORDER BY updatedAt DESC LIMIT 1")
    suspend fun unfinishedFor(artworkId: String): ProjectEntity?

    @Insert
    suspend fun insert(p: ProjectEntity): Long

    @Query("UPDATE coloring_project SET updatedAt = :at, thumbnailPath = :thumb, projectFilePath = :dir WHERE projectId = :id")
    suspend fun touch(id: Long, at: Long, thumb: String, dir: String)

    @Query("UPDATE coloring_project SET completed = :done WHERE projectId = :id")
    suspend fun setCompleted(id: Long, done: Boolean)

    @Query("UPDATE coloring_project SET name = :name WHERE projectId = :id")
    suspend fun rename(id: Long, name: String)

    @Query("DELETE FROM coloring_project WHERE projectId = :id")
    suspend fun delete(id: Long)
}

@Database(entities = [ArtworkEntity::class, ProjectEntity::class], version = 1, exportSchema = true)
abstract class AppDb : RoomDatabase() {
    abstract fun artworks(): ArtworkDao
    abstract fun projects(): ProjectDao

    companion object {
        fun open(ctx: Context): AppDb = Room.databaseBuilder(ctx, AppDb::class.java, "eum_kids_coloring.db").build()
    }
}
