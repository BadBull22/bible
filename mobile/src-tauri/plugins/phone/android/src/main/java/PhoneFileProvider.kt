package com.ghostclaw.phone

import androidx.core.content.FileProvider

/** The provider that hands a verse picture to the app it is shared with. A class of its own
 * because the app itself already declares the plain `FileProvider`, and Android allows a
 * provider class to be declared only once in an app. */
class PhoneFileProvider : FileProvider()
