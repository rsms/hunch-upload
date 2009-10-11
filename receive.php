<?
# This is an example of how to receive both XHR and regular multipart file
# uploads using the same script.
#
# This example does not save the files, but only receive then and print
# some info about what it received. See receive-save.php for a an example
# of how to actually save the uploaded files.

# Print info on what parameters we received (for instance "filename").
echo '$_GET => ';print_r($_GET);

if (count($_FILES)) {
	exit('received multipart file(s): '.print_r($_FILES,1));
}
else {
	$input = fopen("php://input", "r");
	while ($data = fread($input, 8192)) $length += strlen($data);
	fclose($input);
	exit('received raw file: "'.$_GET['filename'].'" ('.$length.' B)');
}
?>
