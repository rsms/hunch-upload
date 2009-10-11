<?
# This is an example of how to receive both XHR and regular multipart file
# uploads using the same script. Received files are saved to disk.

# We received multipart-style files upload(s):
if (count($_FILES)) {
	# Move the uploaded file
	$dst = dirname(__FILE__).'/'.basename($_FILES['file']['name']);
	move_uploaded_file($_FILES['file']['tmp_name'], $dst);
	# Note: This sample only handles a single file, which is probably the
	# only case with hunch-upload.js, but you should add code to test
	# the $_FILES for multiple uploads, or things will fail silently.
	exit('received "'.$_FILES['file']['name'].'" ('.$_FILES['file']['size'].' B)');
}
# We received XHR-style (raw) file upload:
else {
	# Stream file directly down to disk
	$output = fopen(dirname(__FILE__).'/'.basename($_GET['filename']), 'w');
	$input = fopen('php://input', 'r');
	$length = stream_copy_to_stream($input, $output);
	fclose($input);
	fclose($output);
	exit('received "'.$_GET['filename'].'" ('.$length.' B)');
}
?>
