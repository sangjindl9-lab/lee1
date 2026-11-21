package kr.eumsoft.purchasenote.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BrokenImage
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ZoomIn
import androidx.compose.material.icons.filled.ZoomOut
import androidx.compose.material.icons.filled.FitScreen
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kr.eumsoft.purchasenote.R
import kr.eumsoft.purchasenote.data.ImageStore
import kr.eumsoft.purchasenote.data.StoredImage

@Composable
fun rememberBitmap(img: StoredImage, maxSide: Int): Bitmap? {
    val c = LocalContext.current
    val b by produceState<Bitmap?>(null, img.fileName, maxSide) {
        value = withContext(Dispatchers.IO) { ImageStore.loadBitmap(ImageStore.file(c, img.fileName), maxSide) }
    }
    return b
}

@Composable
fun Thumb(img: StoredImage, size: Dp, description: String) {
    val b = rememberBitmap(img, 480)
    Box(Modifier.size(size).clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
        if (b != null) Image(b.asImageBitmap(), description, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        else Icon(Icons.Filled.BrokenImage, description)
    }
}

@OptIn(ExperimentalLayoutApi::class)
/** 원본 증빙 확대 보기: 두 손가락 확대 + 버튼(확대/축소/맞춤)으로도 조작 가능 */
@Composable
fun ImageViewerDialog(img: StoredImage, onDismiss: () -> Unit) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(color = Color.Black, modifier = Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().safeDrawingPadding()) {
                Box(Modifier.weight(1f).fillMaxWidth().pointerInput(Unit) {
                    detectTransformGestures { _, pan, z, _ -> scale = (scale * z).coerceIn(1f, 6f); offset = if (scale == 1f) Offset.Zero else offset + pan }
                }, contentAlignment = Alignment.Center) {
                    val b = rememberBitmap(img, 3000)
                    if (b == null) CircularProgressIndicator()
                    else Image(b.asImageBitmap(), stringResource(R.string.receipt_image), Modifier.fillMaxSize().graphicsLayer {
                        scaleX = scale; scaleY = scale; translationX = offset.x; translationY = offset.y }, contentScale = ContentScale.Fit)
                }
                FlowRow(Modifier.fillMaxWidth().padding(8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally)) {
                    FilledTonalButton(onClick = { scale = (scale * 1.5f).coerceAtMost(6f) }) { Icon(Icons.Filled.ZoomIn, null); Text(stringResource(R.string.zoom_in)) }
                    FilledTonalButton(onClick = { scale = (scale / 1.5f).coerceAtLeast(1f); if (scale == 1f) offset = Offset.Zero }) { Icon(Icons.Filled.ZoomOut, null); Text(stringResource(R.string.zoom_out)) }
                    FilledTonalButton(onClick = { scale = 1f; offset = Offset.Zero }) { Icon(Icons.Filled.FitScreen, null); Text(stringResource(R.string.zoom_fit)) }
                    FilledTonalButton(onClick = onDismiss) { Icon(Icons.Filled.Close, null); Text(stringResource(R.string.close)) }
                }
            }
        }
    }
}

