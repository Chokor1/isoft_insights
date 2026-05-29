from setuptools import setup, find_packages

with open("requirements.txt") as f:
	install_requires = f.read().strip().split("\n")

# get version from __version__ variable in isoft_insights/__init__.py
from isoft_insights import __version__ as version

setup(
	name="isoft_insights",
	version=version,
	description="Sales analytics and insights for ERPNext",
	author="Isoft",
	author_email="abbasschokor225@gmail.com",
	packages=find_packages(),
	zip_safe=False,
	include_package_data=True,
	install_requires=install_requires
)
